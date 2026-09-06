import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.document = { readyState: 'loading', addEventListener() {} };
const {
	bindCompose, COPY, fetchAssistantName, handoffConcluded, handoffFormHtml, inboxPayload,
	refusalNeedsHandoffForm, resolveAssistantName, resolveLocale, resolveSiteName, resolveViewMode,
	statusFor
} = await import('./inbox-bubble.js');

// The sentinel `statusDefault` places and `statusFor` turns into the chip. Written out as escapes
// rather than imported: it is NOT exported, and it must not become part of the coral's API just so
// a test can name it. U+2063 either side — see the constant's own comment in inbox-bubble.js.
const AI_CHIP_TOKEN = '⁣AI_CHIP⁣';

function fixture(onSend) {
	const listeners = {};
	const textarea = {
		value: '  hello  ', attrs: {}, focused: false,
		addEventListener(type, fn) { listeners[type] = fn; },
		setAttribute(k, v) { this.attrs[k] = v; },
		removeAttribute(k) { delete this.attrs[k]; },
		focus() { this.focused = true; }
	};
	const button = { disabled: false, textContent: 'Send' };
	const form = {
		addEventListener(type, fn) { listeners[type] = fn; },
		requestSubmit() { return listeners.submit({ preventDefault() {} }); }
	};
	bindCompose(form, textarea, button, 'Sending', 'Send', onSend);
	return { form, textarea, button, listeners };
}

test('success clears and refocuses; failure preserves the draft', async () => {
	const ok = fixture(async () => true);
	await ok.form.requestSubmit();
	assert.equal(ok.textarea.value, '');
	assert.equal(ok.textarea.focused, true);

	const failed = fixture(async () => false);
	await failed.form.requestSubmit();
	assert.equal(failed.textarea.value, '  hello  ');
});

test('Enter sends, while Shift+Enter and composing Enter do not', async () => {
	let sends = 0;
	const x = fixture(async () => { sends++; return true; });
	const key = (extra = {}) => ({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, preventDefault() {}, ...extra });
	x.listeners.keydown(key({ shiftKey: true }));
	x.listeners.keydown(key({ isComposing: true }));
	x.listeners.keydown(key({ keyCode: 229 }));
	assert.equal(sends, 0);
	await x.listeners.keydown(key());
	assert.equal(sends, 1);
});

test('send is disabled and textarea busy until the request settles', async () => {
	let release;
	let calls = 0;
	const x = fixture(() => { calls++; return new Promise((resolve) => { release = resolve; }); });
	const pending = x.form.requestSubmit();
	assert.equal(x.button.disabled, true);
	assert.equal(x.textarea.attrs['aria-busy'], 'true');
	await x.form.requestSubmit();
	assert.equal(calls, 1);
	release(true);
	await pending;
	assert.equal(x.button.disabled, false);
	assert.equal(x.textarea.attrs['aria-busy'], undefined);
});

test('handoff details appear only for a refusal and prefill the asked question', () => {
	assert.equal(refusalNeedsHandoffForm({ kind: 'refused' }), true);
	assert.equal(refusalNeedsHandoffForm({ kind: 'grounded' }), false);
	const html = handoffFormHtml(COPY.en, 'Do you have <tea>?');
	assert.match(html, /<form class="dc-inbox-handoff">/);
	assert.match(html, /Do you have &lt;tea&gt;\?/);
	assert.match(html, /type="email"/);
	assert.doesNotMatch(html, /required/);
});

test('handoff explains optional email in every locale', () => {
	assert.match(handoffFormHtml(COPY.ja, '質問'), /メールアドレスを残していただくと、店主からの返信をメールで受け取れます。残さない場合は、このページに戻ったときだけ返信を確認できます。/);
	assert.match(handoffFormHtml(COPY['zh-tw'], '問題'), /留下 email 才收得到店家的回覆；不留的話，只有回到這個網頁才看得到。/);
	assert.match(handoffFormHtml(COPY.en, 'Question'), /Leave your email to get the owner&#39;s reply by email. Without it, you can only see replies by coming back to this page./);
});

test('handoff payload omits blank identity and includes supplied identity', () => {
	assert.deepEqual(inboxPayload('site', 'cver', null, 'hello', 'https://x/', ''), {
		kind: 'site', id: 'cver', conversation_id: null, text: 'hello', page_url: 'https://x/', _hp: ''
	});
	assert.deepEqual(inboxPayload('site', 'cver', 'conv', 'hello', 'https://x/', '', ' Ada ', ' a@x.test '), {
		kind: 'site', id: 'cver', conversation_id: 'conv', text: 'hello', page_url: 'https://x/', _hp: '',
		visitor_email: 'a@x.test', visitor_name: 'Ada'
	});
});

test('handoff compose clears its prefilled message after successful acknowledgement', async () => {
	const x = fixture(async () => true);
	x.textarea.value = 'prefilled question';
	await x.form.requestSubmit();
	assert.equal(x.textarea.value, '');
	assert.equal(COPY.en.sentToHuman, "Passed to a person — you'll get a reply here.");
});

// ── locale lookup (finding #5: zh-TW pages fell through to English) ────────

test('resolveLocale matches an exact COPY key first', () => {
	assert.equal(resolveLocale('ja'), 'ja');
	assert.equal(resolveLocale('EN'), 'en');
	assert.equal(resolveLocale('zh-tw'), 'zh-tw');
	assert.equal(resolveLocale('zh-cn'), 'zh-cn');
});

test('resolveLocale resolves real-world zh BCP-47 tags, not just the exact key', () => {
	// The tag the cold-read found actually breaking (finding #5): a script
	// subtag this file did not recognise at all.
	assert.equal(resolveLocale('zh-Hant-TW'), 'zh-tw');
	assert.equal(resolveLocale('zh-Hans-CN'), 'zh-cn');
	assert.equal(resolveLocale('zh-Hant'), 'zh-tw');
	assert.equal(resolveLocale('zh-Hans'), 'zh-cn');
	// region without a script subtag
	assert.equal(resolveLocale('zh-HK'), 'zh-tw');
	assert.equal(resolveLocale('zh-MO'), 'zh-tw');
	assert.equal(resolveLocale('zh-SG'), 'zh-cn');
	// bare primary subtag defaults Traditional, REEF's own zh-TW-first default
	assert.equal(resolveLocale('zh'), 'zh-tw');
});

test('resolveLocale falls back to English only for a genuinely unknown tag', () => {
	assert.equal(resolveLocale('ko'), 'en');
	assert.equal(resolveLocale(''), 'en');
	assert.equal(resolveLocale(undefined), 'en');
});

test('zh-cn carries every string zh-tw and ja carry, including the refusal and hand-off copy', () => {
	const keys = Object.keys(COPY.ja);
	for (const key of keys) {
		assert.ok(Object.prototype.hasOwnProperty.call(COPY['zh-cn'], key), `zh-cn missing "${key}"`);
		assert.ok(Object.prototype.hasOwnProperty.call(COPY['zh-tw'], key), `zh-tw missing "${key}"`);
	}
	assert.equal(COPY['zh-cn'].refused, '我没有这方面的记录。');
	assert.equal(COPY['zh-cn'].name, '姓名（选填）');
	assert.equal(typeof COPY['zh-cn'].emailNote, 'string');
	assert.ok(COPY['zh-cn'].emailNote.length > 0);
});

// ── panel title (finding #7: must not be document.title) ───────────────────

test('resolveSiteName prefers data-site-name, then og:site_name, then hostname', () => {
	const withAttr = { getAttribute: (n) => (n === 'data-site-name' ? 'NORTHWIND' : null) };
	assert.equal(resolveSiteName(withAttr, { querySelector: () => null }), 'NORTHWIND');

	const noAttr = { getAttribute: () => null };
	const docWithMeta = {
		querySelector: (sel) => (sel === 'meta[property="og:site_name"]'
			? { getAttribute: () => 'From OG Meta' }
			: null)
	};
	assert.equal(resolveSiteName(noAttr, docWithMeta), 'From OG Meta');

	const docNoMeta = { querySelector: () => null };
	assert.equal(resolveSiteName(noAttr, docNoMeta), (typeof location !== 'undefined' && location.hostname) || '');
});

test('resolveSiteName ignores blank data-site-name and blank og:site_name', () => {
	const blankAttr = { getAttribute: (n) => (n === 'data-site-name' ? '   ' : null) };
	const docWithBlankMeta = {
		querySelector: (sel) => (sel === 'meta[property="og:site_name"]' ? { getAttribute: () => '  ' } : null)
	};
	assert.notEqual(resolveSiteName(blankAttr, docWithBlankMeta), '   ');
});

// ── status line (finding #8's fix leans on this staying accurate) ──────────

test('statusFor shows the default only before a hand-off, and only when KAITO is on', () => {
	assert.equal(
		statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: true }),
		'KAITO<span class="dc-inbox-ai-chip" aria-label="AI">AI</span>先回，轉出去真人會看'
	);
	assert.equal(statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: false }), '');
});

// ── owner ruling 2026-09-05: the visitor-facing assistant name may change,
// but the AI marker in statusDefault must never depend on it. ──────────────

test('resolveAssistantName reads data-assistant-name, trims it, and falls back to KAITO', () => {
	const withAttr = { getAttribute: (n) => (n === 'data-assistant-name' ? '小美' : null) };
	assert.equal(resolveAssistantName(withAttr), '小美');

	const noAttr = { getAttribute: () => null };
	assert.equal(resolveAssistantName(noAttr), 'KAITO');

	const blankAttr = { getAttribute: (n) => (n === 'data-assistant-name' ? '   ' : null) };
	assert.equal(resolveAssistantName(blankAttr), 'KAITO');

	const whitespaceOnly = { getAttribute: (n) => (n === 'data-assistant-name' ? '\n\t ' : null) };
	assert.equal(resolveAssistantName(whitespaceOnly), 'KAITO');
});

test('resolveAssistantName caps at 40 chars and takes only the first line', () => {
	const long = { getAttribute: (n) => (n === 'data-assistant-name' ? 'a'.repeat(60) : null) };
	assert.equal(resolveAssistantName(long).length, 40);

	const multiline = { getAttribute: (n) => (n === 'data-assistant-name' ? '小美\nignored second line' : null) };
	assert.equal(resolveAssistantName(multiline), '小美');
});

test('statusFor threads a custom assistant name through, and still carries the AI marker', () => {
	assert.equal(
		statusFor(COPY.en, { hasConv: false, hasEmail: false, kaitoOn: true }, '小美'),
		'小美<span class="dc-inbox-ai-chip" aria-label="AI">AI</span>answers first, a person reads what you send on'
	);
	assert.match(
		statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: true }, '小美'),
		/^小美<span class="dc-inbox-ai-chip"/
	);
	// No name supplied — defaults to KAITO, still carrying the marker.
	assert.match(statusFor(COPY.en, { hasConv: false, hasEmail: false, kaitoOn: true }), /^KAITO<span class="dc-inbox-ai-chip"/);
});

// ── owner ruling 2026-09-06 #34: the marker is a CHIP, and it is non-removable
// by construction. These assert the construction, not the styling. ──────────

test('every locale emits exactly one AI chip, and never the sentinel or a parenthetical', () => {
	for (const locale of ['en', 'zh-tw', 'zh-cn', 'ja']) {
		const html = statusFor(COPY[locale], { hasConv: false, hasEmail: false, kaitoOn: true }, '小美');
		// 🔴 COUNT, don't test for presence: a name carrying the sentinel used to split the
		// sentence into three and silently drop the third part (see the strip test below).
		assert.equal(html.split('<span class="dc-inbox-ai-chip"').length - 1, 1, `${locale} chip count`);
		assert.ok(!html.includes(AI_CHIP_TOKEN), `${locale} leaked the sentinel into the DOM`);
		assert.ok(!/\(AI\)|（AI）/.test(html), `${locale} still carries the old parenthetical`);
		assert.match(html, /aria-label="AI"/);
	}
});

test('statusFor escapes the name but not the chip it splices in', () => {
	const html = statusFor(COPY.en, { hasConv: false, hasEmail: false, kaitoOn: true }, '<img src=x onerror=1>');
	assert.ok(!html.includes('<img'), 'the owner-supplied name reached the DOM unescaped');
	assert.match(html, /&lt;img src=x onerror=1&gt;/);
	assert.match(html, /<span class="dc-inbox-ai-chip"/);
});

test('a name carrying the chip sentinel cannot eat the rest of the status line', () => {
	// 🩸 U+2063 is a FORMAT character, not whitespace: `trim()`, the newline split and the
	// 40-char cap all pass it through, so an owner who typed the sentinel used to lose
	// 「自動回覆・需要時可轉真人」 entirely — `split` yielded three parts and `[before, after]`
	// dropped the third. Stripped at intake now (0.7.2), so BOTH halves survive. The sentence
	// after the chip is shorter since 0.7.3; what is being measured is that it is still THERE.
	const el = { getAttribute: (n) => (n === 'data-assistant-name' ? `小${AI_CHIP_TOKEN}美` : null) };
	assert.equal(resolveAssistantName(el), '小美');
	const html = statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: true }, resolveAssistantName(el));
	assert.match(html, /先回，轉出去真人會看$/);
	assert.equal(html.split('<span class="dc-inbox-ai-chip"').length - 1, 1);
});

// ── 0.7.2: the platform's value beats the baked one, at view time ──────────

test('fetchAssistantName returns the platform name, cleaned the same way the baked one is', async () => {
	const seen = [];
	globalThis.fetch = async (url) => {
		seen.push(url);
		return { ok: true, json: async () => ({ ok: true, assistantName: `  小${AI_CHIP_TOKEN}美\nsecond line ` }) };
	};
	// A two-word id on purpose: the space is what proves the id is encoded, not concatenated.
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'northwind art'), '小美');
	assert.equal(seen[0], 'https://feelreef.com/api/inbox/assistant?kind=site&id=northwind%20art');
});

test('fetchAssistantName caps at 40 chars, exactly like the attribute path', async () => {
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ assistantName: 'a'.repeat(60) }) });
	assert.equal((await fetchAssistantName('https://feelreef.com', 'site', 'x')).length, 40);
});

test('fetchAssistantName resolves null — never throws — for every failure the platform can hand it', async () => {
	// 🔴 `null` is the contract: it means「keep whatever is already on screen」. A throw here
	// would reach an unhandled rejection in `mount`, and the whole point of this read is that
	// it can never break the bubble.
	globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), null);

	globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error('not json'); } });
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), null);

	// 🔴 `''` WITHOUT `resolved` — a degraded proxy answer, or an old proxy that predates the
	// field. It still means「we could not establish it」and the baked name still stands.
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, assistantName: '' }) });
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), null);

	globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, assistantName: 42 }) });
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), null);

	globalThis.fetch = async () => { throw new TypeError('network'); };
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), null);
});

// 🩸 REVIEW R2-P1-2 — clearing the name was reported 「已生效」 and was not.
//
// The owner sets 小美, publishes once (so `data-assistant-name="小美"` is baked into the page),
// then clears the field. The platform deletes the row, the proxy answers 「no override」, and the
// coral used to read that as「nothing to correct」— so the visitor saw 小美 for ever while the
// console said the change was live. `resolved` is what separates 「the platform ANSWERED, and the
// answer is: no override」 from 「we could not ask」, and only the first one may beat the bake.
test('R2-P1-2: a RESOLVED empty name clears the baked one back to KAITO', async () => {
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ ok: true, assistantName: '', resolved: true })
	});
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), 'KAITO');
});

test('R2-P1-2: `resolved` never overrides a name the platform actually sent', async () => {
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ ok: true, assistantName: '小美', resolved: true })
	});
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), '小美');
});

test('R2-P1-2: only `resolved === true` counts — a truthy lookalike is still「we could not ask」', async () => {
	// The field crosses a service boundary; anything but the literal `true` is treated as absent,
	// so a proxy bug can only ever cost the CONSERVATIVE outcome (keep the baked name).
	for (const resolved of ['true', 1, {}, null, undefined]) {
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => ({ ok: true, assistantName: '', resolved })
		});
		assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), null);
	}
});

test('the late rename patches the name nodes — it does not re-render the panel', () => {
	// The behavioural proof (a visitor's draft surviving the rename) needs a real DOM and lives
	// in reef's `inbox-bubble.svelte.test.ts`, which drives this exact artifact in chromium.
	// What is checkable HERE is the structural half: `applyAssistantName` exists, and the
	// platform read's `.then` calls it instead of the render functions that assign innerHTML.
	const source = readFileSync(fileURLToPath(new URL('./inbox-bubble.js', import.meta.url)), 'utf8');
	const then = source.match(/void fetchAssistantName\([\s\S]*?\n\t\}\);/);
	assert.ok(then, 'expected the platform read to be a fire-and-forget .then in mount()');
	assert.match(then[0], /applyAssistantName\(\)/);
	assert.ok(!/render(Open|Closed|Ask|Messages)\(\)/.test(then[0]),
		'the platform read must not re-render a panel the visitor is typing in');
	assert.match(source, /function applyAssistantName\(\)/);
});

test('askAgain threads a custom assistant name through, in every locale', () => {
	assert.equal(COPY.en.askAgain('小美'), 'Ask 小美 again');
	assert.equal(COPY['zh-tw'].askAgain('小美'), '重新問 小美');
	assert.equal(COPY.ja.askAgain('小美'), 'もう一度小美に聞く');
	assert.equal(COPY['zh-cn'].askAgain('小美'), '重新问 小美');
	// Default name, unset — every locale still says KAITO.
	assert.match(COPY.en.askAgain('KAITO'), /KAITO/);
	assert.match(COPY['zh-tw'].askAgain('KAITO'), /KAITO/);
});

test('statusFor switches to the hand-off wording once a conversation exists, by email presence', () => {
	assert.equal(
		statusFor(COPY['zh-tw'], { hasConv: true, hasEmail: true, kaitoOn: true }),
		'已交給店家，會透過信箱回覆'
	);
	assert.equal(
		statusFor(COPY['zh-tw'], { hasConv: true, hasEmail: false, kaitoOn: true }),
		'已交給店家，回覆會顯示在這裡'
	);
});

// ── owner ruling 2026-09-07 (「太囉唆」): the ask panel opens with a status line and a
// placeholder, and nothing else. The body line in the empty log (`empty`) and the
// 「站主看得到」 footer under the form (`seen`) were REMOVED, not shortened.
//
// 🩸 The test this replaced asserted the FOOTER's bottom margin (owner report 2026-09-03: it sat
// flush against the panel edge). Keeping it would have been a gate defending the spacing of an
// element that no longer renders — green for ever, about nothing.
//
// 🔴 ASSERTED AS ABSENCE OF THE KEY, not of the sentence. A locale that re-grew
// 「想問什麼都可以，是真人在看。」 under a NEW name would pass a string comparison and put the
// line straight back on screen, so what is pinned is that there is no key for it to come back in.

const LOCALES = ['en', 'zh-tw', 'zh-cn', 'ja'];
const CORAL_SOURCE = readFileSync(fileURLToPath(new URL('./inbox-bubble.js', import.meta.url)), 'utf8');
// 🔴 COMMENTS STRIPPED, the same trick release.mjs uses on a client before diffing it against a
// bundle. The removal is DOCUMENTED in that file — the 🩸 explaining where `copy.empty` went names
// it — so a scan of the raw text would fail on the comment that explains why it should pass, and
// the fix for that would be to stop writing the comment. `(^|\s)//` rather than a bare `//` so the
// `https://` inside DEFAULT_API_BASE survives.
const CORAL_CODE = CORAL_SOURCE
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');

test('🔴 the body line and the footer sentence are gone from every locale, key and all', () => {
	for (const locale of LOCALES) {
		const copy = COPY[locale];
		assert.ok(!('empty' in copy), `${locale} still carries an "empty" body line`);
		assert.ok(!('seen' in copy), `${locale} still carries a "seen" footer line`);
	}
	// Every string this table still holds, flattened — the removed sentences must not have been
	// moved sideways into some other key rather than deleted.
	const gone = [
		'想問什麼都可以，是真人在看。', '想问什么都可以，是真人在看。',
		'Say anything. A person reads these.', 'なんでもどうぞ。人が読んでいます。',
		'你在這裡問的問題，站主看得到。', '你在这里问的问题，站主看得到。',
		"The site's owner can read what you ask here.", 'ここでの質問は、サイトの運営者が読めます。'
	];
	for (const locale of LOCALES) {
		const strings = Object.values(COPY[locale]).map((v) => (typeof v === 'function' ? v('KAITO') : String(v)));
		for (const sentence of gone) {
			assert.ok(!strings.includes(sentence), `${locale} still says "${sentence}" under some other key`);
		}
	}
});

test('🔴 nothing renders the removed lines any more — no -seen element, no copy.empty read', () => {
	// The source, not the table: a key can be gone while the renderer still reaches for it, which
	// is `undefined` printed into the panel rather than a line that disappeared.
	assert.ok(!/copy\.empty|base\.empty|empty-label/.test(CORAL_CODE),
		'the renderer still reads an `empty` string that COPY no longer defines');
	assert.ok(!/copy\.seen/.test(CORAL_CODE), 'the renderer still reads a `seen` string that COPY no longer defines');
	assert.ok(!/\$\{PREFIX\}-seen/.test(CORAL_CODE),
		'the .dc-inbox-seen element or its stylesheet rule is still here');
	// 🔴 CONTROL: the strip above must not have eaten the file. A regex that deleted everything
	// would make all three assertions above pass and say nothing.
	assert.match(CORAL_CODE, /\$\{PREFIX\}-hint/, 'the comment strip removed real code — this scan measured nothing');
	// The ask panel's log opens EMPTY — the placeholder in the box is the only invitation left.
	assert.match(CORAL_CODE, /<div class="\$\{PREFIX\}-log"><\/div>/);
});

test('🔴 the title line still carries the AI marker after data-assistant-name substitution, in every locale', () => {
	for (const locale of LOCALES) {
		const el = { getAttribute: (n) => (n === 'data-assistant-name' ? '小美' : null) };
		const html = statusFor(COPY[locale], { hasConv: false, hasEmail: false, kaitoOn: true }, resolveAssistantName(el));
		assert.ok(html.startsWith('小美'), `${locale} lost the substituted name: ${html}`);
		assert.equal(html.split('<span class="dc-inbox-ai-chip"').length - 1, 1, `${locale} chip count`);
		assert.match(html, /aria-label="AI"/, `${locale} chip lost its accessible name`);
		assert.ok(!html.includes(AI_CHIP_TOKEN), `${locale} leaked the sentinel`);
		// The shortened sentence is still a sentence — the marker must not be the whole line.
		assert.ok(html.replace(/<[^>]*>/g, '').replace('小美', '').replace('AI', '').trim().length > 0,
			`${locale} status line is nothing but a name and a chip`);
	}
	// The 40-char cap and the default both still end up marked.
	const capped = { getAttribute: (n) => (n === 'data-assistant-name' ? 'あ'.repeat(60) : null) };
	const cappedHtml = statusFor(COPY.ja, { hasConv: false, hasEmail: false, kaitoOn: true }, resolveAssistantName(capped));
	assert.ok(cappedHtml.startsWith('あ'.repeat(40) + '<span class="dc-inbox-ai-chip"'), cappedHtml.slice(0, 80));
	assert.match(statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: true }), /^KAITO<span class="dc-inbox-ai-chip"/);
});

test('the shortened title line reads as the owner ruled it, per locale', () => {
	assert.equal(COPY['zh-tw'].statusDefault('KAITO'), `KAITO${AI_CHIP_TOKEN}先回，轉出去真人會看`);
	assert.equal(COPY.en.statusDefault('KAITO'), `KAITO${AI_CHIP_TOKEN}answers first, a person reads what you send on`);
	assert.equal(COPY['zh-cn'].statusDefault('KAITO'), `KAITO${AI_CHIP_TOKEN}先回，转出去真人会看`);
	assert.equal(COPY.ja.statusDefault('KAITO'), `KAITO${AI_CHIP_TOKEN}が先に回答・送れば人が読みます`);
	// Traditional and Simplified are two rows for a reason — see inbox-form-copy.test.mjs.
	assert.notEqual(COPY['zh-tw'].statusDefault('K'), COPY['zh-cn'].statusDefault('K'));
});

test('the ask placeholder is the short one, and every locale writes it in its own script', () => {
	assert.equal(COPY['zh-tw'].ask, '問這個站的事…');
	assert.equal(COPY.en.ask, 'Ask about this site…');
	assert.equal(COPY['zh-cn'].ask, '问这个网站的事…');
	assert.equal(COPY.ja.ask, 'このサイトについて質問…');
	assert.notEqual(COPY['zh-tw'].ask, COPY['zh-cn'].ask);
	for (const locale of LOCALES) {
		assert.ok(COPY[locale].ask.length > 0, `${locale} ask is empty`);
		// It is a PLACEHOLDER, not a paragraph — the whole point of the ruling.
		assert.ok(COPY[locale].ask.length <= 40, `${locale} ask is ${COPY[locale].ask.length} chars`);
	}
});

// ── bug #1 (2026-09-04): the hand-off used to be a one-way door — once a
// visitor escalated to a person, every later open showed that human thread
// forever, with no way back to KAITO or a fresh question. ───────────────────

test('handoffConcluded trusts a server-declared status first, closed or resolved', () => {
	const now = Date.now();
	assert.equal(handoffConcluded([], 'closed', now), true);
	assert.equal(handoffConcluded([], 'resolved', now), true);
	// Any OTHER declared status — including one this file has never heard of —
	// is trusted too: the server said something, so the client-side transcript
	// heuristic below does not get to disagree with it.
	assert.equal(handoffConcluded([{ author: 'owner', at: now - 999 * 24 * 60 * 60 * 1000 }], 'open', now), false);
});

test('handoffConcluded falls back to "no owner reply for 7 days" when the server sends no status', () => {
	const now = Date.now();
	const day = 24 * 60 * 60 * 1000;
	// The owner never replied at all — still waiting, not concluded.
	assert.equal(handoffConcluded([{ author: 'visitor', at: now - 30 * day }], null, now), false);
	// The owner replied recently — not concluded.
	assert.equal(handoffConcluded([{ author: 'owner', at: now - 1 * day }], null, now), false);
	// The owner's last reply was over 7 days ago — concluded.
	assert.equal(handoffConcluded([{ author: 'owner', at: now - 8 * day }], null, now), true);
	// Exactly at the boundary is not yet over it.
	assert.equal(handoffConcluded([{ author: 'owner', at: now - 7 * day }], null, now), false);
	// The LATEST owner message is what counts, not the first.
	assert.equal(
		handoffConcluded(
			[{ author: 'owner', at: now - 20 * day }, { author: 'owner', at: now - 1 * day }],
			null,
			now
		),
		false
	);
	// No messages at all, or a malformed transcript — never concluded.
	assert.equal(handoffConcluded([], null, now), false);
	assert.equal(handoffConcluded(null, null, now), false);
});

test('resolveViewMode: no hand-off yet asks KAITO when offered, else the plain compose form', () => {
	assert.equal(resolveViewMode({ hasHandoffConv: false, storedMode: 'human', concluded: false, kaitoOn: true }), 'ask');
	assert.equal(resolveViewMode({ hasHandoffConv: false, storedMode: 'human', concluded: false, kaitoOn: false }), 'human');
});

test('resolveViewMode: a concluded thread always returns to ask mode, overriding the visitor\'s last choice', () => {
	assert.equal(resolveViewMode({ hasHandoffConv: true, storedMode: 'human', concluded: true, kaitoOn: true }), 'ask');
	assert.equal(resolveViewMode({ hasHandoffConv: true, storedMode: 'human', concluded: true, kaitoOn: false }), 'ask');
});

test('resolveViewMode: a live thread follows the visitor\'s stored choice — this is the bug fix', () => {
	// Default: the existing thread, exactly like before this fix.
	assert.equal(resolveViewMode({ hasHandoffConv: true, storedMode: 'human', concluded: false, kaitoOn: true }), 'human');
	// 🔴 The escape hatch: a visitor who pressed "ask KAITO again" / "start a
	// new conversation" gets ask mode even though a live human thread exists —
	// this is exactly the case that used to be impossible.
	assert.equal(resolveViewMode({ hasHandoffConv: true, storedMode: 'ask', concluded: false, kaitoOn: true }), 'ask');
	assert.equal(resolveViewMode({ hasHandoffConv: true, storedMode: 'ask', concluded: false, kaitoOn: false }), 'ask');
});

test('the second-action label switches between "ask <assistant> again" and "start a new conversation" by data-kaito, in every locale', () => {
	for (const locale of ['en', 'zh-tw', 'zh-cn', 'ja']) {
		const copy = COPY[locale];
		assert.equal(typeof copy.askAgain, 'function');
		assert.ok(copy.askAgain('KAITO').length > 0, `${locale} askAgain is empty`);
		assert.equal(typeof copy.newConversation, 'string');
		assert.ok(copy.newConversation.length > 0, `${locale} newConversation is empty`);
		assert.equal(typeof copy.backToHuman, 'string');
		assert.ok(copy.backToHuman.length > 0, `${locale} backToHuman is empty`);
		assert.equal(typeof copy.handoffEnded, 'string');
		assert.ok(copy.handoffEnded.length > 0, `${locale} handoffEnded is empty`);
	}
});
