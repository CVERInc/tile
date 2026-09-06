import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.document = { readyState: 'loading', addEventListener() {} };
const {
	acceptHandoff, bindCompose, COPY, fetchAssistantName, handoffConcluded, handoffFormHtml,
	handoffState, inboxPayload, parseHandle, pollGeneration, refusalNeedsHandoffForm,
	resolveAssistantName, resolveLocale, resolveSiteName, resolveViewMode, shouldAutoOpenFromHash,
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

// ── #13: a programmatic way to open the panel ───────────────────────────────

test('shouldAutoOpenFromHash: only the exact #inbox fragment, never a prefix match', () => {
	assert.equal(shouldAutoOpenFromHash('#inbox'), true);
	assert.equal(shouldAutoOpenFromHash('#inbox-pricing'), false);
	assert.equal(shouldAutoOpenFromHash('#other'), false);
	assert.equal(shouldAutoOpenFromHash(''), false);
	assert.equal(shouldAutoOpenFromHash(undefined), false);
});

// NOTE ON COVERAGE: mount() wires window.addEventListener('reef-inbox:open', ...) and calls
// shouldAutoOpenFromHash(location.hash) itself — both only ever run for an element that already
// passed the data-kind/data-id guard at the top of mount(), which is what makes each inert
// wherever the coral is not mounted. mount() builds real DOM (document.createElement,
// root.querySelector, ...) that this jsdom-free suite has no stand-in for, so the wiring itself —
// and the "opening focuses the ask input" behaviour, which falls out for free because openPanel
// calls the same renderOpen() a click already did — is not exercised here. What is checked here
// is the one pure decision mount() delegates to: shouldAutoOpenFromHash. The DOM-level proof
// belongs in reef's own inbox-bubble.svelte.test.ts, which already drives this exact artifact in
// a real browser.

// ── #15: the handle hand-off — the mounted panel adopts an externally-minted handle ─────────

test('parseHandle accepts exactly the shape saveHandle stores, ts included', () => {
	assert.deepEqual(parseHandle({ conv: 'c1', ts: 1000, hasEmail: true, mode: 'human' }),
		{ conv: 'c1', ts: 1000, hasEmail: true, mode: 'human' });
	assert.deepEqual(parseHandle({ conv: 'c2', ts: 1000 }),
		{ conv: 'c2', ts: 1000, hasEmail: false, mode: 'human' });
	assert.deepEqual(parseHandle({ conv: 'c3', ts: 1000, mode: 'ask' }),
		{ conv: 'c3', ts: 1000, hasEmail: false, mode: 'ask' });
	// An unrecognised mode normalises to 'human' — the same rule saveHandle itself applies when it
	// writes the value in the first place.
	assert.deepEqual(parseHandle({ conv: 'c4', ts: 1000, mode: 'bogus' }),
		{ conv: 'c4', ts: 1000, hasEmail: false, mode: 'human' });
});

test('parseHandle ignores a malformed detail — no exception thrown, just null back', () => {
	assert.equal(parseHandle(undefined), null);
	assert.equal(parseHandle(null), null);
	assert.equal(parseHandle('a string'), null);
	assert.equal(parseHandle(42), null);
	assert.equal(parseHandle({}), null);
	assert.equal(parseHandle({ conv: 123, ts: Date.now() }), null); // conv not a string
	assert.equal(parseHandle({ conv: 'c', ts: 'not a number' }), null); // ts not a number
	assert.equal(parseHandle({ ts: Date.now() }), null); // no conv at all
	assert.equal(parseHandle([1, 2, 3]), null); // an array is typeof 'object' but has no conv/ts
	// REVIEW B6: typeof NaN is 'number', and every TTL comparison against a NaN answers "fresh",
	// so this was the one malformed timestamp that used to pass the shape test AND the expiry one.
	assert.equal(parseHandle({ conv: 'c', ts: NaN }), null);
	assert.equal(parseHandle({ conv: 'c', ts: Infinity }), null);
});

// REVIEW B3 (2026-09-08): the listener took ANY well-formed detail from ANY script on the page,
// which meant a page script chose which conversation the visitor's next message was filed under,
// and overwrote the only pointer this browser had to the visitor's own thread. The rules now live
// in acceptHandoff, so they are assertable without a DOM.
//
// The panel-side transition is handoffState, separately, for the same reason: the listener used
// to be a state change and a redraw welded together (review B11).

const DAY = 24 * 60 * 60 * 1000;
const MOUNT = { nodeName: 'DIV' }; // stands in for the coral's own element - identity is the point
const OTHER_MOUNT = { nodeName: 'DIV' };

test('B3: a handle addressed to this mount is adopted', () => {
	const now = 1_000_000_000_000;
	assert.deepEqual(
		acceptHandoff({ target: MOUNT, conv: 'c1', ts: now - DAY, hasEmail: true, mode: 'human' },
			{ target: MOUNT, currentTs: 0, now }),
		{ conv: 'c1', ts: now - DAY, hasEmail: true, mode: 'human' }
	);
});

test('B3: an event that does not name THIS mount is refused', () => {
	const now = 1_000_000_000_000;
	const at = { target: MOUNT, currentTs: 0, now };
	// The review's own payload: a script that just fires at window, naming nobody. This is the one
	// that used to redirect the visitor's next message into a conversation of the sender's choice.
	assert.equal(acceptHandoff({ conv: 'ATTACKER-OWNED-CONV-ID', ts: now, mode: 'human' }, at), null);
	// Naming the wrong coral is no better than naming none.
	assert.equal(acceptHandoff({ target: OTHER_MOUNT, conv: 'c', ts: now }, at), null);
	// Lookalikes are not the element: identity is ===, never a shape test.
	assert.equal(acceptHandoff({ target: { nodeName: 'DIV' }, conv: 'c', ts: now }, at), null);
	assert.equal(acceptHandoff({ target: 'site:cver', conv: 'c', ts: now }, at), null);
	// And a mount that somehow has no element cannot be addressed at all, rather than matching
	// every detail that happens to leave `target` undefined.
	assert.equal(acceptHandoff({ conv: 'c', ts: now }, { target: null, currentTs: 0, now }), null);
});

test('B3: a malformed detail is still just ignored, addressed or not', () => {
	const now = 1_000_000_000_000;
	const at = { target: MOUNT, currentTs: 0, now };
	for (const detail of [undefined, null, 'a string', 42, {}, [1, 2, 3]]) {
		assert.equal(acceptHandoff(detail, at), null);
	}
	assert.equal(acceptHandoff({ target: MOUNT, conv: 123, ts: now }, at), null);
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'c' }, at), null);
	// No options at all — the listener is the only caller, but a null-safe default is what keeps
	// "this file did not raise the event" true of the helper as well.
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'c', ts: now }), null);
});

test('B6: the event path honours the same TTL storage does, and cannot restamp its way past it', () => {
	const now = 1_000_000_000_000;
	const at = { target: MOUNT, currentTs: 0, now };
	// The review's payloads: ts values that used to be accepted and then rewritten to Date.now(),
	// bringing a long-dead conversation id back for another thirty days.
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'x', ts: 0 }, at), null);
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'x', ts: -1 }, at), null);
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'x', ts: NaN }, at), null);
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'x', ts: now - 31 * DAY }, at), null);
	// Just inside the window is still inside it, and the boundary itself is not over it.
	assert.ok(acceptHandoff({ target: MOUNT, conv: 'x', ts: now - 29 * DAY }, at));
	assert.ok(acceptHandoff({ target: MOUNT, conv: 'x', ts: now - 30 * DAY }, at));
	// 🔴 The adopted ts is the SENDER's, never `now` — that is what stops adoption granting an
	// extension the storage path would have refused.
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'x', ts: now - 29 * DAY }, at).ts, now - 29 * DAY);
});

test('B3: an older handle never replaces a newer one', () => {
	const now = 1_000_000_000_000;
	const held = now - 2 * DAY;
	const at = { target: MOUNT, currentTs: held, now };
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'older', ts: now - 3 * DAY }, at), null);
	// Same age is allowed: re-sending the handle the panel already holds, with a different mode,
	// is a legitimate move and not a rewind.
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'same', ts: held, mode: 'ask' }, at).mode, 'ask');
	assert.equal(acceptHandoff({ target: MOUNT, conv: 'newer', ts: now - DAY }, at).conv, 'newer');
});

test('B3: handoffState adopts the thread and clears everything the old conversation owned', () => {
	const ts = 1_000_000_000_000;
	assert.deepEqual(handoffState({ conv: 'c9', ts, hasEmail: true, mode: 'human' }), {
		handoffConv: 'c9',
		hasEmail: true,
		storedMode: 'human',
		handleTs: ts,
		conv: 'c9',
		// 🔴 The old conversation's transcript, status, ended-note and reply window all go. A
		// message from the PREVIOUS thread surviving into the new panel is exactly the bug the
		// in-flight refresh guard exists to stop; nothing static may reintroduce it either.
		messages: [],
		conversationStatus: null,
		handoffEndedNote: false,
		replyWithinHours: null
	});
});

test('B3: an adopted ask-mode handle keeps the thread but shows no active conversation', () => {
	const ts = 1_000_000_000_000;
	const state = handoffState({ conv: 'c9', ts, hasEmail: false, mode: 'ask' });
	assert.equal(state.handoffConv, 'c9', 'the thread is still reachable behind the quiet link');
	assert.equal(state.conv, null, 'ask mode has no active conversation to send into or poll');
	assert.equal(state.storedMode, 'ask');
});

test('B3: the listener delegates to acceptHandoff, addressed to its own element', () => {
	// 🔴 The rules above are only worth anything if the listener actually asks them. This is the
	// structural half, in the same style as the late-rename test: a listener that went back to
	// calling parseHandle direct would keep every assertion above green while accepting exactly
	// the events they exist to refuse.
	const listener = CORAL_SOURCE.match(/window\.addEventListener\('reef-inbox:handle'[\s\S]*?\n\t\}\);/);
	assert.ok(listener, 'expected the hand-off listener in mount()');
	assert.match(listener[0], /acceptHandoff\(event && event\.detail, \{ target: el, currentTs: handleTs \}\)/);
	assert.ok(!/parseHandle\(/.test(listener[0]), 'the listener bypasses acceptHandoff');
	// And it writes the handle with the ts it adopted, not a fresh one (B6).
	assert.match(listener[0], /storeHandle\(handoffConv, hasEmail, storedMode, handleTs\)/);
});

// REVIEW B4 (2026-09-08): the README told integrators the opposite of what the code does.

const README = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8');

test('B4: the README does not deny the localStorage write the hand-off actually performs', () => {
	// The code half, so this test measures the two against each other rather than against a
	// sentence somebody typed: the listener writes the adopted handle.
	const listener = CORAL_CODE.match(/window\.addEventListener\('reef-inbox:handle'[\s\S]*?\n\t\}\);/);
	assert.ok(listener && /storeHandle\(/.test(listener[0]), 'the hand-off listener no longer writes');
	// The README half. An integrator who believed the old sentence ("it assumes the emitter
	// already has") would design around a write that happens anyway, under a key they did not
	// choose, over a handle they cannot get back.
	assert.ok(!/does not write to `localStorage`/.test(README), 'the README denies the write again');
	assert.match(README, /DOES write the adopted handle to `localStorage`/);
});

test('B4: the README quotes the TTL the code actually enforces', () => {
	// 🩸 The same class of drift, found while fixing B4: the TTL went from seven days to thirty on
	// 2026-09-04 and this line did not. Pinned to the constant so the next bump cannot leave it
	// behind either.
	const days = Number(CORAL_CODE.match(/const HANDLE_TTL_MS = (\d+) \* 24 \* 60 \* 60 \* 1000;/)[1]);
	assert.equal(days, 30);
	assert.match(README, new RegExp(`expires locally after ${days} days`));
});

// REVIEW B2 (2026-09-08): stopPolling() cleared the interval and nothing else, so a transcript
// fetch already in the air came back after the hand-off and painted the OLD conversation into
// the NEW panel — both views render into the same .dc-inbox-log, so it looked like part of it.

test('B2: a result that arrives after invalidate() is dropped, not applied', async () => {
	const generation = pollGeneration();
	// The panel, reduced to what the race actually corrupts.
	const panel = { conv: 'old-conv', messages: [{ text: 'old' }] };
	let settle;
	// The delayed fetch: still in flight when the hand-off arrives.
	const inFlight = generation.run(
		() => new Promise((resolve) => { settle = resolve; }),
		(got) => { panel.messages = got.messages; return true; }
	);

	// ...the hand-off. stopPolling() invalidates, then the panel adopts the new conversation.
	generation.invalidate();
	panel.conv = 'new-conv';
	panel.messages = [];

	// ...and only NOW does the old conversation's transcript come back.
	settle({ messages: [{ text: 'from the old conversation' }] });
	assert.equal(await inFlight, false, 'the stale result was applied');
	assert.deepEqual(panel.messages, [], 'the old transcript landed in the new panel');
});

test('B2: an uninterrupted result is applied exactly as before', async () => {
	const generation = pollGeneration();
	let settle;
	const applied = [];
	const inFlight = generation.run(
		() => new Promise((resolve) => { settle = resolve; }),
		(got) => { applied.push(got); return true; }
	);
	settle({ messages: ['a reply'] });
	assert.equal(await inFlight, true);
	assert.deepEqual(applied, [{ messages: ['a reply'] }]);
});

test('B2: invalidating cancels what is in flight without cancelling what starts after it', async () => {
	const generation = pollGeneration();
	const applied = [];
	let settleFirst;
	const first = generation.run(
		() => new Promise((resolve) => { settleFirst = resolve; }),
		(got) => { applied.push(got); return true; }
	);
	generation.invalidate();
	// The new view's own first read, started after the tear-down — this one must survive.
	const second = generation.run(async () => 'new', (got) => { applied.push(got); return true; });
	settleFirst('old');
	assert.equal(await first, false);
	assert.equal(await second, true);
	assert.deepEqual(applied, ['new']);
});

test('B2: a rejected fetch is a null result, never an unhandled rejection from a timer', async () => {
	const generation = pollGeneration();
	const seen = [];
	assert.equal(
		await generation.run(async () => { throw new TypeError('network'); }, (got) => { seen.push(got); return false; }),
		false
	);
	assert.deepEqual(seen, [null], 'the failure path must still be told the request failed');
	// And a failure that arrives after a tear-down is not even counted.
	let settle;
	const inFlight = generation.run(() => new Promise((_, reject) => { settle = reject; }), () => {
		throw new Error('apply must not run for an invalidated failure');
	});
	generation.invalidate();
	settle(new TypeError('network'));
	assert.equal(await inFlight, false);
});

test('B2: refresh() runs through the generation, and stopPolling() invalidates it', () => {
	// The structural half: the guard is only real if refresh() is the thing wearing it.
	const stop = CORAL_SOURCE.match(/function stopPolling\(\) \{[\s\S]*?\n\t\}/);
	assert.ok(stop, 'expected stopPolling() in mount()');
	assert.match(stop[0], /generation\.invalidate\(\)/);

	const refreshFn = CORAL_SOURCE.match(/async function refresh\(\) \{[\s\S]*?\n\t\}\n/);
	assert.ok(refreshFn, 'expected refresh() in mount()');
	assert.match(refreshFn[0], /generation\.run\(/);
	assert.ok(!/const got = await fetchTranscript/.test(refreshFn[0]),
		'refresh() awaits the transcript outside the generation guard again');
	// The re-render's first read must be started AFTER the tear-down, or it invalidates itself.
	assert.match(CORAL_CODE, /stopPolling\(\);\n\t\trefresh\(\);\n\t\tpoller = setInterval\(refresh, POLL_MS\);/);
});

// NOTE ON COVERAGE: what remains inside mount() for this event is three lines — call
// acceptHandoff, copy handoffState's fields onto the panel's own variables, stopPolling() and
// re-render. The decisions and the transition are both above, driven by their real inputs; the
// DOM half (which render function runs) is left to reef's own browser-driven suite.

// ── #17: the assistant-name cap counts grapheme clusters, and bidi/format controls are stripped ──

test('#17: the 40-char cap counts grapheme clusters, so a name under the cap is never touched', () => {
	// The issue's own repro: 21 grapheme clusters (well under the cap) but 41 UTF-16 code units --
	// the old .slice(0, 40) cut one code unit short of completing the 20th emoji's surrogate
	// pair, producing a lone high surrogate.
	const raw = 'a' + '\u{1F600}'.repeat(20);
	const el = { getAttribute: (n) => (n === 'data-assistant-name' ? raw : null) };
	const name = resolveAssistantName(el);
	assert.equal(name, raw);
	if (typeof name.isWellFormed === 'function') assert.equal(name.isWellFormed(), true);
});

test('#17: a name OVER the cap is truncated by whole grapheme, never mid-surrogate-pair', () => {
	const raw = '\u{1F600}'.repeat(45); // 45 grapheme clusters, 90 UTF-16 code units
	const el = { getAttribute: (n) => (n === 'data-assistant-name' ? raw : null) };
	const name = resolveAssistantName(el);
	assert.equal(name, '\u{1F600}'.repeat(40));
	if (typeof name.isWellFormed === 'function') assert.equal(name.isWellFormed(), true);
});

test('#17: the Array.from fallback (no Intl.Segmenter) is also grapheme-safe, not a UTF-16 slice', () => {
	const realSegmenter = Intl.Segmenter;
	delete Intl.Segmenter;
	try {
		const raw = '\u{1F600}'.repeat(45);
		const el = { getAttribute: (n) => (n === 'data-assistant-name' ? raw : null) };
		const name = resolveAssistantName(el);
		assert.equal(name, '\u{1F600}'.repeat(40));
		if (typeof name.isWellFormed === 'function') assert.equal(name.isWellFormed(), true);
	} finally {
		Intl.Segmenter = realSegmenter;
	}
});

// Every bidi/format control the issue names (U+202A-202E, U+2066-2069, U+061C, U+200E/U+200F),
// spelled as \u escapes — never as literal source bytes. A literal bidi override sitting in this
// file's own text is exactly the "Trojan Source" (CVE-2021-42574) class of problem the code under
// test exists to strip; the escape is how the test asserts the stripping without reintroducing it.
const BIDI_TEST_CONTROLS = [
		'\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069', '\u061C', '\u200E', '\u200F'
	];

test('#17: every bidi/format control the issue names is stripped from the name', () => {
	for (const ctrl of BIDI_TEST_CONTROLS) {
		const el = { getAttribute: (n) => (n === 'data-assistant-name' ? `\u5C0F${ctrl}\u7F8E` : null) };
		const name = resolveAssistantName(el);
		assert.equal(name, '\u5C0F\u7F8E', `control U+${ctrl.codePointAt(0).toString(16).toUpperCase()} survived`);
	}
});

test('#17: an RTL-override payload cannot reach the status line unisolated', () => {
	// The issue's own example: a name opening with U+202E would otherwise flip the reading
	// direction of everything after it in the same rendered sentence.
	const el = { getAttribute: (n) => (n === 'data-assistant-name' ? '\u202Eevil' : null) };
	const name = resolveAssistantName(el);
	assert.equal(name, 'evil');
	const html = statusFor(COPY.en, { hasConv: false, hasEmail: false, kaitoOn: true }, name);
	assert.ok(!html.includes('\u202E'));
	assert.match(html, /^evil<span class="dc-inbox-ai-chip"/);
});

// REVIEW B1 (P1, 2026-09-08): the two strips ran in the order that let one UNDO the other.
//
// 0.7.4 added the bidi strip AFTER the AI_CHIP_TOKEN strip, so a control character the token
// strip could not see and the bidi strip then deleted smuggled the token in and reassembled it
// downstream -- the exact invariant the 0.7.2 test above ('a name carrying the chip sentinel
// cannot eat the rest of the status line') defends, walked around through the side door.
//
// The payload is written with \u escapes, never literal bytes: a literal U+202E in this file
// would render this test's own source in an order that does not match how it runs, which is the
// Trojan Source class (CVE-2021-42574) the code under test exists to strip.
const SMUGGLED_TOKEN = '\u2063A\u202EI_CHIP\u2063';

// The half of the zh-TW status line that follows the chip, taken from COPY rather than retyped:
// what is being asserted is that the sentence SURVIVES, and hardcoding it here would make this
// test fail on the day the owner rewords it, for a reason that has nothing to do with B1. It
// carries no HTML-escapable character, so statusFor's escHtml leaves it byte-for-byte.
const ZH_STATUS_TAIL = COPY['zh-tw'].statusDefault('').split(AI_CHIP_TOKEN)[1];

function chipCount(html) {
	return html.split('<span class="dc-inbox-ai-chip"').length - 1;
}

function nameFromAttribute(raw) {
	return resolveAssistantName({ getAttribute: (n) => (n === 'data-assistant-name' ? raw : null) });
}

test('B1: a bidi control cannot smuggle the chip sentinel past the strip and reassemble it', () => {
	// The reassembly, spelled out: delete the U+202E from this payload by hand and what is left
	// IS the sentinel. That is what the old order handed to statusFor.
	assert.equal(SMUGGLED_TOKEN.replace(/\u202E/g, ''), AI_CHIP_TOKEN);

	// Nothing survives the two strips, so the name falls back -- a sentinel is not a name.
	assert.equal(nameFromAttribute(SMUGGLED_TOKEN), 'KAITO');

	const html = statusFor(
		COPY['zh-tw'],
		{ hasConv: false, hasEmail: false, kaitoOn: true },
		nameFromAttribute(SMUGGLED_TOKEN)
	);
	// The two things the smuggled token used to break: the sentence after the chip was eaten
	// whole, and the name went with it, leaving one lone chip as the entire status line.
	assert.ok(html.endsWith(ZH_STATUS_TAIL), `the status line lost its tail: ${JSON.stringify(html)}`);
	assert.equal(chipCount(html), 1, 'chip count');
	assert.ok(!html.includes(AI_CHIP_TOKEN), 'the sentinel reached the DOM');
	assert.ok(!html.includes('\u202E'), 'the override reached the DOM');
});

test('B1: every stripped control works as the smuggling character, at any position - none of them do now', () => {
	for (const ctrl of BIDI_TEST_CONTROLS) {
		// Two insertion points, because the review measured that the position does not matter.
		for (const payload of [`\u2063A${ctrl}I_CHIP\u2063`, `\u2063AI_CH${ctrl}IP\u2063`]) {
			const label = `U+${ctrl.codePointAt(0).toString(16).toUpperCase()}`;
			const name = nameFromAttribute(`小${payload}美`);
			assert.ok(!name.includes(AI_CHIP_TOKEN), `${label} rebuilt the sentinel`);
			const html = statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: true }, name);
			assert.equal(chipCount(html), 1, label);
			assert.ok(html.endsWith(ZH_STATUS_TAIL), label);
		}
	}
});

test('B1: the platform path shares the helper, so the same payload dies there too', async () => {
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ ok: true, assistantName: SMUGGLED_TOKEN, resolved: true })
	});
	// `resolved: true` with nothing left after cleaning means "the owner cleared the name" - KAITO.
	assert.equal(await fetchAssistantName('https://feelreef.com', 'site', 'x'), 'KAITO');
});

// REVIEW B7 (2026-09-08): counting grapheme clusters removed the LENGTH limit. A cluster has no
// upper bound, so 40 clusters can be 20,040 UTF-16 units, and the pre-#17 .slice(0, 40) was the
// only thing that had been bounding it.

test('B7: the cap is clusters AND code units - a 40-cluster Zalgo wall does not get through', () => {
	// The review's own payload: exactly 40 clusters, 20,040 units, waved through untouched.
	const zalgo = ('a' + '\u0301'.repeat(500)).repeat(40);
	assert.equal(zalgo.length, 20040);
	// The first cluster alone is 501 units - over the ceiling on its own, so nothing fits and the
	// name falls back rather than being cut mid-sequence.
	assert.equal(nameFromAttribute(zalgo), 'KAITO');
});

test('B7: the ceiling truncates on a cluster boundary, it does not slice UTF-16', () => {
	// 10-unit clusters ('a' plus nine combining acutes): 40 of them is 400 units, so the UNIT
	// ceiling bites first, at 20 clusters, and lands exactly on a boundary.
	const cluster = 'a' + '\u0301'.repeat(9);
	const name = nameFromAttribute(cluster.repeat(40));
	assert.equal(name, cluster.repeat(20));
	assert.ok(name.length <= 200, `${name.length} units got through`);
	if (typeof name.isWellFormed === 'function') assert.equal(name.isWellFormed(), true);
	// A plain 60-character name is still capped at 40: the ceiling only ever binds on text that is
	// long in units without being long in characters.
	assert.equal(nameFromAttribute('a'.repeat(60)), 'a'.repeat(40));
});

test('B7: the platform read enforces the ceiling too - it is the same last line of defence', async () => {
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ ok: true, assistantName: ('a' + '\u0301'.repeat(9)).repeat(40) })
	});
	const name = await fetchAssistantName('https://feelreef.com', 'site', 'x');
	assert.ok(name.length <= 200, `the platform path let ${name.length} units through`);
});

// REVIEW B8 (2026-09-08): with and without Intl.Segmenter, the same name came out different --
// a ZWJ family x45 capped to 40 families with a Segmenter and 8 without one -- and the fallback
// left a dangling U+200D where it cut.

test('B8: with and without Intl.Segmenter the cap produces the SAME name', () => {
	const inputs = {
		emoji: '\u{1F600}'.repeat(45),
		zwjFamily: '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'.repeat(45),
		rainbowFlag: '\u{1F3F3}\uFE0F\u200D\u{1F308}'.repeat(45),
		regionalFlags: '\u{1F1F9}\u{1F1FC}'.repeat(45),
		combining: 'e\u0301'.repeat(45),
		skinTone: '\u{1F44D}\u{1F3FF}'.repeat(45),
		keycap: '1\uFE0F\u20E3'.repeat(45),
		hangul: '각'.repeat(45),
		zalgo: ('a' + '\u0301'.repeat(9)).repeat(40),
		// A joiner between two things that are NOT both pictographs does not weld them: this is 41
		// clusters, not 40, and the fallback has to agree with the Segmenter about that too.
		joinerBetweenNonPictographs: 'a'.repeat(40) + '\u200D\u{1F469}',
		// The review's own dangling-joiner case: 38 plain characters then one family.
		reviewDanglingJoiner: 'a'.repeat(38) + '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
	};
	const realSegmenter = Intl.Segmenter;
	for (const [label, raw] of Object.entries(inputs)) {
		const withSegmenter = nameFromAttribute(raw);
		let without;
		delete Intl.Segmenter;
		try {
			without = nameFromAttribute(raw);
		} finally {
			Intl.Segmenter = realSegmenter;
		}
		assert.equal(without, withSegmenter, `${label}: the fallback produced a different name`);
		if (typeof without.isWellFormed === 'function') assert.equal(without.isWellFormed(), true, label);
	}
});

test('B8: a name never ends on a dangling joiner, on either path', () => {
	const realSegmenter = Intl.Segmenter;
	// A long joiner chain is ONE cluster on both paths, and it ends on a joiner with nothing after
	// it to join -- exactly the debris the review measured, arriving from the input rather than
	// from the cut now that clusters are never split.
	const chain = '\u{1F468}\u200D'.repeat(45);
	for (const path of ['segmenter', 'fallback']) {
		if (path === 'fallback') delete Intl.Segmenter;
		try {
			assert.ok(!nameFromAttribute(chain).endsWith('\u200D'), `${path} left a dangling U+200D`);
			// A joiner the OWNER typed at the end of a short name is the same debris.
			assert.equal(nameFromAttribute('小美\u200D'), '小美', path);
		} finally {
			Intl.Segmenter = realSegmenter;
		}
	}
});

test('#17: the platform read (fetchAssistantName) is capped and stripped the same way as the baked attribute', async () => {
	globalThis.fetch = async () => ({
		ok: true,
		json: async () => ({ ok: true, assistantName: `\u5C0F\u202E\u7F8E` })
	});
	const name = await fetchAssistantName('https://feelreef.com', 'site', 'x');
	assert.equal(name, '\u5C0F\u7F8E');
});
