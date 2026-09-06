import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.document = { readyState: 'loading', addEventListener() {} };
const {
	bindCompose, COPY, fetchAssistantName, handoffConcluded, handoffFormHtml, inboxPayload,
	parseHandle, pollGeneration, privateCharsOf, refusalNeedsHandoffForm, resolveAssistantName,
	resolveLocale, resolveSiteName, resolveViewMode, shouldAutoOpenFromHash, statusFor
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
	assert.equal(shouldAutoOpenFromHash('#inbox', '1'), true);
	assert.equal(shouldAutoOpenFromHash('#inbox-pricing', '1'), false);
	assert.equal(shouldAutoOpenFromHash('#other', '1'), false);
	assert.equal(shouldAutoOpenFromHash('', '1'), false);
	assert.equal(shouldAutoOpenFromHash(undefined, '1'), false);
});

// REVIEW B5 (2026-09-08): the fragment that opens the panel is written by whoever authored the
// LINK, not by the site. Without an opt-in, any external page, email or QR code could make a
// customer's site open a panel and take the cursor, on any page, for every visitor.

test('B5: #inbox does nothing unless the SITE opted in with data-open-on-hash="1"', () => {
	// The review's own payloads - an outside link at a page the site never marked up for this.
	assert.equal(shouldAutoOpenFromHash('#inbox', null), false, 'attribute absent');
	assert.equal(shouldAutoOpenFromHash('#inbox', undefined), false);
	assert.equal(shouldAutoOpenFromHash('#inbox', ''), false, 'attribute present but empty');
	// Exactly "1", the same shape data-kaito already uses - not "true", not any truthy string.
	assert.equal(shouldAutoOpenFromHash('#inbox', '0'), false);
	assert.equal(shouldAutoOpenFromHash('#inbox', 'true'), false);
	assert.equal(shouldAutoOpenFromHash('#inbox', 'yes'), false);
	assert.equal(shouldAutoOpenFromHash('#inbox', '1'), true);
});

test('B5: mount reads the opt-in from the mount element, and wires the entry point before the fetch', () => {
	assert.match(CORAL_CODE,
		/shouldAutoOpenFromHash\(location\.hash, el\.getAttribute\('data-open-on-hash'\)\)/);
	// 🔴 Order, not just presence: the listener used to be registered after `await refresh()`, so
	// a site dispatching reef-inbox:open from its own DOMContentLoaded handler raced a network
	// round trip for a listener to exist, and #inbox stole focus a round trip late.
	const listenAt = CORAL_CODE.indexOf("window.addEventListener('reef-inbox:open'");
	const readAt = CORAL_CODE.indexOf('if (conv && !open) await refresh();');
	assert.ok(listenAt > 0 && readAt > 0, 'mount no longer has the two lines');
	assert.ok(listenAt < readAt, 'the open listener is registered behind a network round trip again');
});

// REVIEW B3 (2026-09-08, round 2): tile #15's `reef-inbox:handle` event is GONE, not narrowed.
// Addressing it to `detail.target` fixed misdelivery between two corals and left the file header's
// own invariant false — the address is the mount element, and the README's own snippet showed how
// to look one up, so any script on the page could still choose which conversation the visitor's
// next message was filed under. A hand-off is a full navigation now: reef's `/report` form writes
// storage and the coral re-reads it at mount, which is the one intake this file has.

test('B3: nothing is left of the hand-off event — no listener, no export, no README recipe', async () => {
	assert.equal(CORAL_CODE.includes('reef-inbox:handle'), false, 'the listener is back');
	const api = await import('./inbox-bubble.js');
	assert.equal('acceptHandoff' in api, false, 'acceptHandoff is exported again');
	assert.equal('handoffState' in api, false, 'handoffState is exported again');
	// 🔴 NEITHER WINDOW LISTENER NAMES A CONVERSATION, which is the claim B3 actually left behind —
	// not the count. `reef-inbox:open` says "open", nothing more; `pagehide` (0.7.6, ruling 54) is
	// the browser's own event and takes no argument at all. The count is asserted so that a THIRD
	// one has to be a deliberate act, and both are named so that swapping one for a listener that
	// does take a handle cannot pass by keeping the total the same.
	assert.equal((CORAL_CODE.match(/window\.addEventListener\(/g) || []).length, 2);
	assert.match(CORAL_CODE, /window\.addEventListener\('reef-inbox:open', openPanel\);/);
	assert.match(CORAL_CODE, /window\.addEventListener\('pagehide', \(\) => aiLog\.flush\(\)\);/);
});

// REVIEW B3, ROUND 3: the test that used to sit here asserted that the header SENTENCE existed
// (`assert.match(CORAL_SOURCE, /WHICH IS WHY THERE IS NO HAND-OFF EVENT/)`), and the sentence it
// pinned was false — a page script that writes `reef-inbox:<kind>:<id>` and navigates still picks
// the conversation, which is the recipe the README itself gives. A regex measures wording, not
// truth. The claim the file can keep — one window listener, of one type, naming no conversation,
// and no export that takes a handle — is asserted against a real mount() in mount.test.mjs.
//
// What is left here is the DOCUMENT half, and it is stated as a limit rather than an absolute: the
// header has to keep saying that the storage intake is reachable by any same-origin script.

test('B3: the header bounds its own claim to what this file controls', () => {
	// The sentence the review called a false claim, in the form it took while the event existed.
	assert.equal(/AND THAT SURVIVES `reef-inbox:handle`/.test(CORAL_SOURCE), false);
	assert.match(CORAL_SOURCE, /THE CONVERSATION ID COMES FROM THE SERVER/);
	// 🩸 An absolute claim about what「no script on the page」can do is the thing that was wrong.
	// The header may say this file offers no API for it; it may not say nobody can.
	assert.equal(/NO SCRIPT ON THE PAGE PICKS IT EITHER/.test(CORAL_SOURCE), false,
		'the header claims a page script cannot pick the conversation — the storage intake means it can');
	assert.match(CORAL_SOURCE, /can still choose the conversation a visitor's next message is filed under/);
	assert.match(CORAL_SOURCE, /third-party script it does not trust \(ads, analytics, a plugin\)/);
});

// REVIEW B9 (2026-09-08): there is still no unmount path, so the listener above is never removed.
// The honest half of the fix is that there is now only ONE of them, and the file says so.

test('B9: the window listeners per mount are bounded, and mount() documents that nothing removes them', () => {
	// Two since 0.7.6 (`reef-inbox:open` and ruling 54's `pagehide`). B9's cost is unchanged in
	// kind — a page accumulates a fixed number per element it ever mounted, not per re-render —
	// and this number is pinned so growing it stays a decision somebody makes on purpose.
	assert.equal((CORAL_CODE.match(/window\.addEventListener\(/g) || []).length, 2);
	assert.equal(CORAL_CODE.includes('removeEventListener'), false,
		'a teardown appeared — B9 can now be closed properly, and this test should assert it instead');
	assert.match(CORAL_SOURCE, /no teardown to remove it from \(review B9, still open\)/);
	// The guard that keeps it one-per-element rather than one-per-render.
	assert.match(CORAL_CODE, /if \(el\.getAttribute\('data-dynamic-coral-mounted'\) === '1'\) return;/);
});

// REVIEW B10 (2026-09-08): reef-inbox:open on an already-open panel was a total no-op, so the
// site's own "report a problem" link read as broken to a visitor who had left the panel open.

test('B10: opening an already-open panel refocuses the compose box instead of doing nothing', () => {
	const openPanel = CORAL_CODE.match(/function openPanel\(\) \{[\s\S]*?\n\t\}/);
	assert.ok(openPanel, 'expected openPanel() in mount()');
	// It still must not re-render - that is what would throw away a half-typed message.
	assert.ok(!/render(Open|Closed|Ask|Messages)\(\);\n\t\t\treturn;/.test(openPanel[0]),
		'the already-open branch re-renders, discarding the visitor\'s draft');
	assert.match(openPanel[0], /if \(open\) \{[\s\S]*?focus\(\)[\s\S]*?return;/);
});

// NOTE ON COVERAGE: what mount() DOES with the event — the render, the focus, the refocus, the
// opt-in — is exercised against the real exported mount() in mount.test.mjs beside this file
// (review B11, round 2: a source regex goes green for a call left in a branch that never runs).
// What is checked here is the pure decision mount() delegates to, and the wiring order.

// ── the stored handle: the one intake, read at mount ────────────────────────

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

test('parseHandle ignores a malformed handle — no exception thrown, just null back', () => {
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

// REVIEW B6 (2026-09-08): a NaN or long-dead `ts` used to come back to life. The TTL now lives on
// one path only — the mount-time storage read — because the event path that also had to answer
// 「how old is this handle」 is gone (B3, round 2).
//
// 🔴 WHERE THE TTL ITSELF IS TESTED: mount.test.mjs, against a real mount() (review B12, round 3).
// What used to be here was `assert.match(load[0], /Date\.now\(\) - handle\.ts > HANDLE_TTL_MS/)`,
// and the review's mutant `if (false && Date.now() - handle.ts > HANDLE_TTL_MS)` left that string
// exactly where it was and the whole suite green — a dead branch reads the same as a live one. The
// 29-day and 31-day handles over there tell them apart. What stays here is the other half of B6,
// which is an ABSENCE and so has nowhere else to live: no caller can supply the `ts`.

test('B6: nothing but a visitor\'s own action supplies the ts saveHandle writes', () => {
	// The parameter that let a caller choose it existed for adoption, which is what B3 removed.
	assert.match(CORAL_CODE, /function saveHandle\(tenant, conv, hasEmail, mode = 'human'\) \{/);
	assert.match(CORAL_CODE, /JSON\.stringify\(\{ conv, ts: Date\.now\(\),/);
	assert.match(CORAL_CODE, /function storeHandle\(convId, email, mode\) \{/);
	// One comparison, in one place: a second one is a second answer to「how old is this handle」.
	assert.equal((CORAL_CODE.match(/HANDLE_TTL_MS/g) || []).length, 2, 'a second TTL check appeared');
});

// REVIEW B4 (2026-09-08): the README told integrators the opposite of what the code does.

const README = readFileSync(fileURLToPath(new URL('./README.md', import.meta.url)), 'utf8');

test('B4: the README documents no event this file no longer has', () => {
	// 🩸 B4 was the README describing a write the code performs as a write it does not. The whole
	// section went with the event (B3, round 2), so what this now measures is that the document and
	// the code agree about what exists at all — an integrator who wires up a recipe the coral has
	// dropped gets silence, which is the same class of failure the original sentence caused.
	assert.equal(CORAL_CODE.includes('reef-inbox:handle'), false);
	// The README may still NAME the event — an integrator who wired it up in 0.7.4 has to be able
	// to find out what happened to it — but it may not hand anybody a recipe for dispatching one.
	assert.equal(/dispatchEvent\([^)]*reef-inbox:handle/.test(README), false,
		'the README still teaches how to dispatch the removed event');
	assert.match(README, /`reef-inbox:handle`[\s\S]{0,120}removed it again/);
	assert.equal(/does not write to `localStorage`/.test(README), false);
	// The event this file DOES have is still documented, and still described as taking no id.
	assert.match(README, /reef-inbox:open/);
	assert.match(CORAL_CODE, /window\.addEventListener\('reef-inbox:open', openPanel\);/);
});

test('B3: the README keeps the warning next to the recipe that needs it', () => {
	// 🩸 Round 2 deleted the storage recipe's own caveat along with the event's, so the README was
	// left teaching how to write the key on one screen and calling the same move impossible on the
	// next. The warning belongs BESIDE the recipe: whoever reads「write the key and navigate」is
	// exactly the reader who has to know who else on the page can do it.
	const section = README.slice(README.indexOf('reef-inbox:<kind>:<id>'),
		README.indexOf('## The three things not to break'));
	assert.ok(section, 'the hand-off section moved — this test is measuring nothing');
	// Whitespace-tolerant: the README is hard-wrapped, so any of these gaps may be a newline.
	assert.match(section, /third-party script it does not trust \(ads,\s+analytics, a plugin\)/);
	assert.match(section, /the same way it has already given it\s+`localStorage` and the DOM/);
	// And the absolute the review struck down — the same claim the file header no longer makes.
	assert.equal(/A full navigation has no such gap/.test(README), false,
		'the README claims the navigation recipe has no gap; it is the same gap, one navigation wide');
	// The expiry is counted from a ts this file did not choose, and the README has to say whose.
	assert.match(section, /the timestamp\s+whoever wrote that key chose/);
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
// fetch already in the air came back after the view had moved on and painted the OLD conversation
// into the new one — every view renders into the same .dc-inbox-log, so it looked like part of it.
// 🔴 The hand-off event that first exposed this is gone (B3, round 2) and the guard stays: every
// close, re-render and "start a new conversation" calls the same stopPolling().

test('B2: a result that arrives after invalidate() is dropped, not applied', async () => {
	const generation = pollGeneration();
	// The panel, reduced to what the race actually corrupts.
	const panel = { conv: 'old-conv', messages: [{ text: 'old' }] };
	let settle;
	// The delayed fetch: still in flight when the visitor starts a new conversation.
	const inFlight = generation.run(
		() => new Promise((resolve) => { settle = resolve; }),
		(got) => { panel.messages = got.messages; return true; }
	);

	// ...the switch. stopPolling() invalidates, then the panel moves to the new conversation.
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

// The platform read, cleaned by the same helper — the second intake point, so every payload below
// is asserted at both. `resolved: true` with nothing left after cleaning means「the owner cleared
// the name」, which is KAITO, exactly as an absent attribute is.
async function nameFromPlatform(raw) {
	const saved = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, assistantName: raw, resolved: true }) });
	try {
		return (await fetchAssistantName('https://feelreef.com', 'site', 'x')) || 'KAITO';
	} finally {
		globalThis.fetch = saved;
	}
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

// REVIEW B1, ROUND 2 (2026-09-08): the smuggling character was never the point. A single
// split(T).join('') REASSEMBLES the token out of the remnants it leaves behind, so the payload
// needs no control character and no second U+2063 at all:
//
//   T.slice(0, 3) + T + T.slice(3)   -- remove the middle T, and the two halves ARE T
//
// The fix is structural rather than ordinal: the token comes out to a fixed point, and then every
// character the token cannot exist without comes out unconditionally. These tests assert the
// STRUCTURE (no sentinel character survives, ever, and cleaning is a fixed point) rather than one
// more payload, because the review's whole point was that payload-shaped defences are enumerable.

// The sentinel's own private characters, taken from the token rather than retyped - if the token
// ever changes its wrapper, this follows it, exactly as AI_CHIP_PRIVATE_RE does in the source.
const SENTINEL_CHARS = [...new Set(AI_CHIP_TOKEN)].filter((ch) => ch.codePointAt(0) > 0x7e);
const NESTED_TOKEN = AI_CHIP_TOKEN.slice(0, 3) + AI_CHIP_TOKEN + AI_CHIP_TOKEN.slice(3);
const DOUBLY_NESTED_TOKEN = NESTED_TOKEN.slice(0, 3) + NESTED_TOKEN + NESTED_TOKEN.slice(3);

test('B1 round 2: one split reassembles the sentinel - this is the payload, spelled out', () => {
	// Not an assertion about the fix: an assertion that the attack is real, so that a future
	// simplification back to a single split cannot pass by making this test meaningless.
	assert.equal(NESTED_TOKEN.split(AI_CHIP_TOKEN).join(''), AI_CHIP_TOKEN);
	assert.equal(DOUBLY_NESTED_TOKEN.split(AI_CHIP_TOKEN).join('').split(AI_CHIP_TOKEN).join(''),
		AI_CHIP_TOKEN);
	// And it carries no bidi control at all - the 0.7.5 strip order has nothing to do with it.
	for (const ctrl of BIDI_TEST_CONTROLS) assert.ok(!NESTED_TOKEN.includes(ctrl));
});

test('B1 round 2: no sentinel character survives cleaning, from any nesting', async () => {
	const payloads = [
		AI_CHIP_TOKEN,
		NESTED_TOKEN,
		DOUBLY_NESTED_TOKEN,
		// Nested AND smuggled, the review's second payload: both weaknesses in one string. The
		// override is written as an escape, never a literal byte - see BIDI_CONTROL_RE.
		NESTED_TOKEN.replace('AI_CHIP', 'A\u202EI_CHIP'),
		// Something real either side, so the KAITO fallback is not what is doing the work.
		`小${NESTED_TOKEN}美`,
		`小${DOUBLY_NESTED_TOKEN}美`,
		// A lone private character that never formed a token at all: still not a thing a name carries.
		...SENTINEL_CHARS.map((ch) => `小${ch}美`)
	];
	for (const payload of payloads) {
		const label = JSON.stringify(payload);
		// Both intake points, because they are one helper and this is the assertion that says so.
		for (const name of [nameFromAttribute(payload), await nameFromPlatform(payload)]) {
			for (const ch of SENTINEL_CHARS) {
				assert.ok(!name.includes(ch),
					`a sentinel character survived cleaning of ${label}: ${JSON.stringify(name)}`);
			}
			assert.ok(!name.includes(AI_CHIP_TOKEN), `the whole sentinel survived ${label}`);
			// 🔴 THE FIXED POINT: cleaning the cleaned name changes nothing. A step that can rebuild
			// what an earlier step removed shows up here as a name that keeps moving.
			assert.equal(nameFromAttribute(name), name, `cleaning is not a fixed point for ${label}`);
			// And the status line keeps both halves: one chip, tail intact.
			const html = statusFor(COPY['zh-tw'], { hasConv: false, hasEmail: false, kaitoOn: true }, name);
			assert.equal(chipCount(html), 1, label);
			assert.ok(html.endsWith(ZH_STATUS_TAIL), `${label} lost the tail: ${JSON.stringify(html)}`);
		}
	}
});

// REVIEW B14 (2026-09-08, round 3): the comment above AI_CHIP_PRIVATE_RE promises that a sentinel
// which ever changes its wrapper is covered "the day it changes". With four-digit `\uXXXX` escapes
// and no `u` flag that was true only for a BMP wrapper: U+1F5A5 was spelled `὚5`, which reads
// as U+1F5A followed by the digit 5 — the new wrapper survives (B1's guarantee silently off) and
// two unrelated characters are deleted instead. Nothing throws. So the promise is tested against a
// wrapper the sentinel does not use, which is the only way to test a promise about CHANGING it.

test('B14: the private-character class covers a non-BMP wrapper, not the pieces of one', () => {
	const astral = '\u{1F5A5}'; // a stand-in wrapper: astral, so a surrogate pair
	const re = privateCharsOf(`${astral}AI_CHIP${astral}`);

	// The wrapper itself goes, whole.
	assert.equal(`小${astral}美`.replace(re, ''), '小美');
	assert.equal(`${astral}AI_CHIP${astral}`.replace(re, ''), 'AI_CHIP');
	// 🩸 And the two characters the old spelling deleted by accident stay: `὚5` without the
	// `u` flag is the class { U+1F5A, '5' }, so 「὚」 and every digit 5 in somebody's name went.
	assert.equal('὚5'.replace(re, ''), '὚5');
	assert.equal('小5美'.replace(re, ''), '小5美');
	// Half a surrogate pair is not a match either — the class is code points, not units.
	assert.equal(astral.slice(0, 1).replace(re, ''), astral.slice(0, 1));
	// ASCII is still excluded on purpose: the letters are a legal name, the wrapper is not.
	assert.equal('AI_CHIP'.replace(re, ''), 'AI_CHIP');

	// The live sentinel keeps behaving exactly as it did — the derivation, not the token, changed.
	const live = privateCharsOf(AI_CHIP_TOKEN);
	for (const ch of SENTINEL_CHARS) assert.equal(`小${ch}美`.replace(live, ''), '小美');
});

test('B1 round 2: a name that is nothing but sentinel is no name at all, nested or not', () => {
	// The courtesy half of the strip: a pure sentinel cleans to empty and falls back, rather than
	// leaving the bare letters of the marker behind as somebody's assistant name.
	assert.equal(nameFromAttribute(NESTED_TOKEN), 'KAITO');
	assert.equal(nameFromAttribute(DOUBLY_NESTED_TOKEN), 'KAITO');
	// ...while those letters typed BY THEMSELVES are just letters. The invisible wrapper is what a
	// name may not carry; "AI_CHIP" as ASCII never was, and stripping it would be censoring text.
	assert.equal(nameFromAttribute('AI_CHIP'), 'AI_CHIP');
});

test('B1 round 2: the cap cannot be used to cut a name back into a sentinel', () => {
	// The cap runs AFTER the strip, so it only ever deletes. This is the payload that would matter
	// if that were ever reordered: a full 40 clusters of padding with a nested token behind it.
	const padded = '小'.repeat(40) + NESTED_TOKEN;
	const name = nameFromAttribute(padded);
	for (const ch of SENTINEL_CHARS) assert.ok(!name.includes(ch), 'the cap left a sentinel behind');
	assert.equal(name, '小'.repeat(40));
});

test('B1 round 2: an enormous nested name is bounded before the fixed point, not after', () => {
	// Deep nesting is what makes a repeated strip expensive, so the input is bounded first (the
	// same class as B7, on the cost side rather than the output side). Asserted on the outcome: a
	// bounded, sentinel-free name, arriving promptly rather than after a quadratic walk.
	const deep = NESTED_TOKEN.repeat(20000); // ~360k UTF-16 units
	const started = Date.now();
	const name = nameFromAttribute(deep);
	assert.ok(Date.now() - started < 2000, 'cleaning a huge name took seconds');
	assert.ok(name.length <= 200);
	for (const ch of SENTINEL_CHARS) assert.ok(!name.includes(ch));
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

// REVIEW B13 (2026-09-08, round 3): the joiner strip ran BEFORE the final trim(), so a trim could
// uncover a joiner that nothing looked at again. B8's own comment claimed it ran "after every cut
// that could produce one", and `.trim()` on the same line was one of those cuts.

test('B13: a joiner uncovered by the final trim is removed too, on either path', () => {
	const realSegmenter = Intl.Segmenter;
	for (const path of ['segmenter', 'fallback']) {
		if (path === 'fallback') delete Intl.Segmenter;
		try {
			// 🩸 The review's case. The strip takes the last joiner, the trim then takes the space
			// that was hiding the one before it — and the old order stopped there, handing the DOM
			// 「小美 ZWJ」.
			assert.equal(nameFromAttribute('小美\u200D \u200D'), '小美', path);
			// Deeper alternation, and whitespace of more than one kind.
			assert.equal(nameFromAttribute('小美\u200D\t\u200D \u200D'), '小美', path);
			// A cleaned name is a FIXED POINT: cleaning it again may not change it (the property the
			// round-3 fuzz run failed on — 200,000 cases, this shape the only one).
			const once = nameFromAttribute('小小\u200D \u200D\nA');
			assert.equal(nameFromAttribute(once), once, path);
			assert.ok(!once.endsWith('\u200D'), `${path} left a dangling U+200D`);
			// The joiners that are NOT debris still are not: a family emoji is untouched.
			const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
			assert.equal(nameFromAttribute(family), family, path);
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

// ── ruling 54: the deferred question log ────────────────────────────────────────────────────
//
// Everything below drives `createAiLog` with an injected world — a Map for storage, a counter for
// the clock, an array for the transport — because the behaviour worth pinning is arithmetic, and
// arithmetic that can only be exercised through a browser is arithmetic nobody exercises.

const {
	AI_LOG_CLAIM_RETRY_MS, AI_LOG_CLAIM_TTL_MS, AI_LOG_IDLE_MS, AI_LOG_MAX_QUESTIONS,
	AI_LOG_MAX_FIELD, AI_LOG_MAX_PAGES, AI_LOG_MAX_PAGE_BYTES, AI_LOG_MAX_TEXT,
	AI_LOG_MAX_WIRE_BYTES, AI_QUESTION_FIELDS, AI_SESSION_FIELDS, aiLogKey, aiPagePath,
	aiSessionPayload, appendAiPage, capAiPages, capAiQuestions, createAiLog, parseAiLog,
	probeInboxClaim, sendAiSession, utf8Bytes
} = await import('./inbox-bubble.js');

function logFixture(over = {}) {
	const cells = new Map();
	const storage = {
		getItem: (k) => (cells.has(k) ? cells.get(k) : null),
		setItem: (k, v) => cells.set(k, v)
	};
	const sent = [];
	let clock = 1_700_000_000_000;
	let n = 0;
	const log = createAiLog({
		tenant: 'site:acme',
		kind: 'site',
		id: 'acme',
		storage,
		now: () => clock,
		newId: () => `sid-${++n}`,
		send: (payload) => {
			sent.push(payload);
			return true;
		},
		probeClaim: async () => true,
		...over
	});
	return {
		log, sent, cells, storage,
		tick: (ms) => (clock += ms),
		at: () => clock,
		/** The claim probe is a promise; let it settle before asserting on a flush. */
		settle: () => new Promise((r) => setTimeout(r, 0))
	};
}

test('54: the caps are applied on the way IN — 20 questions of 500 chars, oldest dropped', () => {
	const rows = [];
	for (let i = 0; i < 25; i++) rows.push({ text: `q${i}`, page: '/', hit: null, lang: '', at: i });
	const capped = capAiQuestions(rows);
	assert.equal(capped.length, AI_LOG_MAX_QUESTIONS);
	// The OLDEST went: the newest question — the one somebody would escalate on — is still here.
	assert.equal(capped[capped.length - 1].text, 'q24');
	assert.equal(capped[0].text, 'q5');

	const long = capAiQuestions([{ text: 'x'.repeat(4000), page: '/', at: 1 }]);
	assert.equal(long[0].text.length, AI_LOG_MAX_TEXT);
	// 🔴 Not `'x'.repeat(n)` alone as the specimen — that cannot tell「kept the head」from
	// 「kept the tail」. An uneven one can.
	const uneven = capAiQuestions([{ text: `HEAD${'x'.repeat(4000)}TAIL`, page: '/', at: 1 }]);
	assert.ok(uneven[0].text.startsWith('HEAD'));
	assert.ok(!uneven[0].text.endsWith('TAIL'));
});

test('54: a page is a PATH — no query string, no fragment, ever', () => {
	assert.equal(aiPagePath('https://shop.example/pricing?token=abc123&email=a@b.c'), '/pricing');
	assert.equal(aiPagePath('https://shop.example/a/b#inbox'), '/a/b');
	assert.equal(aiPagePath(''), '/');
	assert.equal(aiPagePath(undefined), '/');
	// Consecutive duplicates collapse; a real move does not.
	assert.deepEqual(appendAiPage(['/a'], '/a'), ['/a']);
	assert.deepEqual(appendAiPage(['/a'], '/b'), ['/a', '/b']);
});

test('54: it flushes ONCE — a second pagehide with nothing new sends nothing', async () => {
	const f = logFixture();
	f.log.page('/pricing');
	f.log.question('do you ship to Japan?', '/pricing', 'https://shop.example/faq', 'ja-jp');
	await f.settle();

	const first = f.log.flush();
	assert.ok(first, 'the first flush carries the session');
	assert.equal(f.sent.length, 1);
	assert.equal(first.session_id, 'sid-1');
	assert.equal(first.questions.length, 1);
	assert.equal(first.questions[0].hit, 'https://shop.example/faq');
	assert.deepEqual(first.pages, ['/pricing']);

	assert.equal(f.log.flush(), null, 'a second pagehide sends nothing new');
	assert.equal(f.sent.length, 1);

	// One more question, and the SAME session id goes again — which is exactly why the server
	// has to be idempotent on it rather than inserting a row per request.
	f.log.question('and to Korea?', '/pricing', null, 'ja-jp');
	const second = f.log.flush();
	assert.equal(second.session_id, 'sid-1');
	assert.equal(second.questions.length, 2);
	assert.equal(f.sent.length, 2);
});

test('54: an unclaimed tenant writes NOTHING, and「we could not ask」is not permission', async () => {
	const unclaimed = logFixture({ probeClaim: async () => false });
	unclaimed.log.page('/');
	unclaimed.log.question('anyone there?', '/', null, '');
	await unclaimed.settle();
	assert.equal(unclaimed.log.flush(), null);
	assert.equal(unclaimed.sent.length, 0);
	// 🔴 And it did not merely refuse to send — it stopped holding them.
	assert.equal(unclaimed.log.state().questions.length, 0);

	// A probe that never answered leaves `claim` null, and null behaves exactly like false.
	const unknown = logFixture({ probeClaim: async () => null });
	unknown.log.question('anyone there?', '/', null, '');
	await unknown.settle();
	assert.equal(unknown.log.flush(), null);
	assert.equal(unknown.sent.length, 0);
	// …but the questions are still HELD, so the next page view can send them once we know.
	assert.equal(unknown.log.state().questions.length, 1);
});

test('54: data-ai-log="0" buffers nothing, probes nothing, sends nothing', async () => {
	const f = logFixture({ enabled: false });
	assert.equal(f.log.enabled(), false);
	f.log.page('/');
	f.log.question('hello?', '/', null, '');
	await f.settle();
	assert.equal(f.log.flush(), null);
	assert.equal(f.sent.length, 0);
	assert.equal(f.log.state(), null);
	assert.equal(f.cells.size, 0, 'nothing reached storage either');
});

test('54: the press flushes with the handle and CLEARS the session', async () => {
	const f = logFixture({ probeClaim: async () => null });
	f.log.page('/pricing');
	f.log.question('can I return it?', '/pricing', null, '');
	// 🔴 No settled probe at all here, on purpose: a minted conversation id is itself proof the
	// tenant is claimed, so escalation must send without one.
	const went = await f.log.escalated('conv-7');
	assert.ok(went);
	assert.equal(went.handle, 'conv-7');
	assert.equal(went.questions.length, 1);

	const after = f.log.state();
	assert.equal(after.questions.length, 0, 'cleared');
	assert.equal(after.pages.length, 0);
	assert.notEqual(after.sid, went.session_id, 'a fresh session, so nothing travels twice');
	assert.equal(after.claim, true, 'and the claim answer is now known without a probe');

	// A press with nothing buffered sends nothing at all.
	const quiet = logFixture();
	assert.equal(await quiet.log.escalated('conv-8'), null);
	assert.equal(quiet.sent.length, 0);
});

test('54: a session spans pages and ends on idle, not on navigation', async () => {
	const f = logFixture();
	f.log.page('/');
	f.log.question('what are your hours?', '/', null, '');
	await f.settle();
	// A navigation: new document, new mount, same buffer.
	f.tick(30_000);
	const second = logFixture();
	// (the fixture above is a second browser; this one keeps going in the same storage)
	f.log.page('/contact');
	assert.deepEqual(f.log.state().pages, ['/', '/contact']);
	assert.equal(f.log.state().sid, 'sid-1');
	assert.equal(second.sent.length, 0);

	// Idle past the ceiling and the next page view is a new session — with the claim answer
	// carried over, since that is a fact about the SITE and not about this visit.
	f.tick(AI_LOG_IDLE_MS + 1);
	f.log.page('/again');
	assert.equal(f.log.state().sid, 'sid-2');
	assert.deepEqual(f.log.state().pages, ['/again']);
	assert.equal(f.log.state().claim, true);
});

test('54: the 21st question is not silently pre-marked as sent by the cap', async () => {
	const f = logFixture();
	for (let i = 0; i < AI_LOG_MAX_QUESTIONS; i++) f.log.question(`q${i}`, '/', null, '');
	await f.settle();
	f.log.flush();
	assert.equal(f.sent.length, 1);
	assert.equal(f.log.state().sent, AI_LOG_MAX_QUESTIONS);

	// 🩸 `sent` counts from the front, so the cap dropping the oldest has to bring it down too.
	// Clamping it to the new LENGTH instead makes this question look already-flushed.
	f.log.question('the one they escalate on', '/', null, '');
	const went = f.log.flush();
	assert.ok(went, 'the 21st question still travels');
	assert.equal(went.questions.length, AI_LOG_MAX_QUESTIONS);
	assert.equal(went.questions[AI_LOG_MAX_QUESTIONS - 1].text, 'the one they escalate on');
});

test('54: a malformed buffer somebody else wrote is ignored, not thrown', () => {
	assert.equal(parseAiLog(null), null);
	assert.equal(parseAiLog({ sid: '', started: 1, last: 1 }), null);
	assert.equal(parseAiLog({ sid: 'x', started: NaN, last: 1 }), null);
	const ok = parseAiLog({ sid: 'x', started: 1, last: 2, questions: [{ text: 'a', at: 3 }], sent: 99 });
	assert.equal(ok.sent, 1, 'a `sent` that outran the buffer cannot永久 convince us there is nothing left');
	assert.equal(ok.claim, null);

	const f = logFixture();
	f.cells.set(aiLogKey('site:acme'), '{ not json');
	f.log.page('/');
	assert.ok(f.log.state().sid, 'a corrupt cell starts a new session rather than taking the panel down');
});

test('54: the beacon carries a JSON Blob, and falls back to keepalive fetch', async () => {
	const beacons = [];
	const okBeacon = sendAiSession('https://feelreef.com/api/inbox/session', { a: 1 }, {
		navigator: { sendBeacon: (url, blob) => (beacons.push({ url, blob }), true) },
		Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } }
	});
	assert.equal(okBeacon, true);
	// 🔴 `application/json`, not the `text/plain` a bare-string beacon sends — the endpoint
	// refuses an unlabelled body, so this is the difference between sending and appearing to.
	assert.equal(beacons[0].blob.type, 'application/json');
	assert.equal(beacons[0].blob.parts[0], '{"a":1}');

	const calls = [];
	const viaFetch = sendAiSession('https://feelreef.com/api/inbox/session', { a: 1 }, {
		navigator: {},
		fetch: (url, init) => (calls.push({ url, init }), Promise.resolve({ ok: true }))
	});
	// 🔴 A PROMISE, not a bare `true` (review D1): the fetch path is the one that can be answered,
	// so what it hands back is what the SERVER said rather than what the browser accepted.
	assert.equal(await viaFetch, true);
	assert.equal(calls[0].init.keepalive, true);
	assert.equal(calls[0].init.headers['content-type'], 'application/json');

	// No transport at all is `false`, never a throw inside a pagehide handler.
	assert.equal(sendAiSession('u', {}, { navigator: {}, fetch: null }), false);
});

// ── review D4 (2026-09-08, round 2): the fallback missed the case it was written for ─────────
//
// 🩸 The comment above the beacon said the fetch below it exists for「a browser that counts it
// against a quota」— and the spec's answer to being over quota is `sendBeacon` RETURNING FALSE,
// which the code returned straight to the caller. The fallback covered the throw, which hardly
// happens, and missed the false, which is the documented one. With D1 in place a false is not
// merely a lost send: it is the answer that decides whether the buffer survives.

const RecordingBlob = class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } };

test('D4: a beacon that refuses falls through to the keepalive fetch, and one that throws does too', async () => {
	for (const [name, sendBeacon] of [
		['returns false (over quota — the documented answer)', () => false],
		['throws', () => { throw new Error('quota'); }],
		['answers something that is not true', () => undefined]
	]) {
		const calls = [];
		const out = sendAiSession('https://feelreef.com/api/inbox/session', { a: 1 }, {
			navigator: { sendBeacon },
			Blob: RecordingBlob,
			fetch: (url, init) => (calls.push(init), Promise.resolve({ ok: true, status: 200 }))
		});
		assert.equal(calls.length, 1, `a beacon that ${name} lost the session`);
		assert.equal(JSON.parse(calls[0].body).a, 1);
		assert.equal(await out, true);
	}

	// With no fetch to fall through TO, a refused beacon is an honest `false` — which is what
	// keeps the questions in the browser rather than reporting them told.
	assert.equal(sendAiSession('u', { a: 1 },
		{ navigator: { sendBeacon: () => false }, Blob: RecordingBlob, fetch: null }), false);
});

/** Every field of a question at its character cap, in a script where one character is 3 octets. */
const worstCaseQuestions = () => {
	const rows = [];
	for (let i = 0; i < AI_LOG_MAX_QUESTIONS; i++) {
		rows.push({ text: '嗎'.repeat(AI_LOG_MAX_TEXT), page: '/' + '產品'.repeat(99),
			hit: `https://shop.example/${'a'.repeat(150)}`, lang: 'zh-tw', at: 1_770_000_000_000 });
	}
	return rows;
};

test('D4: the questions are bounded in OCTETS too, and the two units are not the same number', () => {
	const capped = capAiQuestions(worstCaseQuestions());
	assert.equal(capped.length, AI_LOG_MAX_QUESTIONS, 'a legitimate Chinese session lost questions');
	const bytes = utf8Bytes(JSON.stringify(capped));
	// 🔴 THE ARITHMETIC NOBODY HAD DONE. 20 × 500 characters is a number about UTF-16; what the
	// transport counts is this one, and it is three times bigger in Chinese. The questions are
	// bounded by the character caps alone — raise `AI_LOG_MAX_TEXT` or `AI_LOG_MAX_QUESTIONS`
	// past what the wire will take and this goes red before a visitor's session does.
	assert.ok(bytes > JSON.stringify(capped).length, 'this specimen is not measuring octets at all');
	assert.ok(bytes < AI_LOG_MAX_WIRE_BYTES * 0.75,
		`the questions alone are ${bytes} octets — there is no room left for the page sequence`);

	// The counting itself, against the cases a hand-rolled encoder gets wrong.
	assert.equal(utf8Bytes('abc'), 3);
	assert.equal(utf8Bytes('é'), 2);
	assert.equal(utf8Bytes('嗎'), 3);
	assert.equal(utf8Bytes('😀'), 4, 'a surrogate pair is one character and four octets');
	assert.equal(utf8Bytes('\ud800'), 3, 'a lone surrogate is what it encodes as, not a crash');
	assert.equal(utf8Bytes(null), 0);
});

test('D4: a body over the wire budget skips the beacon for the path that can report failure', () => {
	const beacons = [];
	const calls = [];
	const env = {
		navigator: { sendBeacon: (url, blob) => (beacons.push(blob), true) },
		Blob: RecordingBlob,
		fetch: (url, init) => (calls.push(init), Promise.resolve({ ok: true }))
	};
	assert.equal(sendAiSession('u', { q: 'a'.repeat(100) }, env), true);
	assert.equal(beacons.length, 1, 'an ordinary body did not take the beacon');
	assert.equal(calls.length, 0);

	sendAiSession('u', { q: '嗎'.repeat(AI_LOG_MAX_WIRE_BYTES / 2) }, env);
	assert.equal(beacons.length, 1, 'a body the beacon cannot carry was handed to it anyway');
	assert.equal(calls.length, 1);
});

// ── review D5 (2026-09-08, round 2): pages[] was bounded in count and in nothing else ────────
//
// 🩸 `AI_LOG_MAX_FIELD`'s own comment says「Longest path or locale tag kept, so neither can be
// used to pad a row」, and `questions[].page` really did go through it. The identical value in
// `pages[]` went through nothing: the review planted a 50,001-character path in this browser's
// cell and watched it reach the wire whole, next to a `questions[0].page` capped to one.

test('D5: a page is bounded in length, in count, and in octets — the constant\'s comment is true now', () => {
	const long = '/' + 'x'.repeat(50_000);
	assert.equal(capAiPages([long])[0].length, AI_LOG_MAX_FIELD, 'a 50,001-character path went whole');
	assert.equal(appendAiPage([], long)[0].length, AI_LOG_MAX_FIELD);
	// The same bound on the way OUT of storage — the review's probe wrote the cell directly.
	assert.equal(parseAiLog({ sid: 'x', started: 1, last: 2, pages: [long] }).pages[0].length,
		AI_LOG_MAX_FIELD);
	// …and on the way onto the wire, which is the only measurement the endpoint ever makes.
	const body = aiSessionPayload('site', 'acme',
		{ sid: 's', pages: [long], questions: [{ text: 'q', page: '/', at: 1 }] });
	assert.equal(body.pages[0].length, AI_LOG_MAX_FIELD);

	// Count, unchanged, and still the OLDEST that go.
	let pages = [];
	for (let i = 0; i < AI_LOG_MAX_PAGES + 5; i++) pages = appendAiPage(pages, `/p${i}`);
	assert.equal(pages.length, AI_LOG_MAX_PAGES);
	assert.equal(pages[pages.length - 1], `/p${AI_LOG_MAX_PAGES + 4}`);

	// Octets: forty Chinese paths at the character cap is 24 KiB, which is more of the beacon's
	// budget than the page sequence gets. The newest survive.
	const cjkPath = (i) => `/${i}` + '產品'.repeat(95); // 192 characters, 574 octets
	let cjk = [];
	for (let i = 0; i < AI_LOG_MAX_PAGES; i++) cjk = appendAiPage(cjk, cjkPath(i));
	assert.ok(cjkPath(0).length <= AI_LOG_MAX_FIELD, 'the specimen is measuring the length cap');
	assert.ok(cjk.length < AI_LOG_MAX_PAGES, 'the octet budget never bit');
	assert.ok(utf8Bytes(JSON.stringify(cjk)) <= AI_LOG_MAX_PAGE_BYTES);
	assert.equal(cjk[cjk.length - 1], cjkPath(AI_LOG_MAX_PAGES - 1));

	// Consecutive duplicates still collapse, and the dedupe compares what will be STORED — a
	// reload of a path longer than the cap is not a second page either.
	assert.deepEqual(appendAiPage(['/a'], '/a'), ['/a']);
	assert.deepEqual(appendAiPage(['/a'], '/b'), ['/a', '/b']);
	assert.deepEqual(appendAiPage([long], long).length, 1);
});

test('D5+D4: the worst session this coral can hold still fits what the transport carries', () => {
	// Every cap at its ceiling, in the script where a character costs three octets — the profile
	// the review measured at 70,403 bytes, over the beacon's 64 KiB. Assembled the way the coral
	// assembles it, not by hand: caps in, wire out.
	let pages = [];
	for (let i = 0; i < AI_LOG_MAX_PAGES; i++) pages = appendAiPage(pages, `/${i}` + '產品'.repeat(95));
	const body = aiSessionPayload('site', 'a-tenant-with-a-long-enough-id', {
		sid: 'x'.repeat(64), pages, questions: worstCaseQuestions(), handle: 'c'.repeat(64)
	});
	const bytes = utf8Bytes(JSON.stringify(body));
	assert.ok(bytes < AI_LOG_MAX_WIRE_BYTES,
		`the worst session this coral can hold is ${bytes} octets — the beacon would refuse it`);
	// And it is not a hollow pass: the body really is most of the budget, in a unit the caps
	// themselves never counted in.
	assert.ok(bytes > AI_LOG_MAX_WIRE_BYTES / 2, 'this specimen is not the worst case any more');
});

// ── review D1 (2026-09-08, round 2): a transport that says no must not destroy the buffer ────
//
// 🩸 `escalated()` computed `went`, returned it, and cleared the session either way. The review's
// probe — `send: () => false` — asked two questions, pressed for a person, and watched both
// questions vanish from the browser while the caller got `null` back and could not tell. That is
// the one row this whole file exists to carry: the question somebody escalated ON.
//
// What is pinned below is the rule in all four of the transport's tenses.

test('D1: a beacon that refuses keeps the buffer, and the next pagehide carries it', async () => {
	let accept = false;
	const f = logFixture({ send: (p) => (accept ? (f.sent.push(p), true) : false) });
	f.log.page('/pricing');
	f.log.question('do you ship to Japan?', '/pricing', null, '');
	f.log.question('and to Korea?', '/pricing', null, '');

	assert.equal(await f.log.escalated('conv-7'), null, 'a refused send reported as a send');
	assert.equal(f.sent.length, 0);
	// 🔴 THE MEASUREMENT. Both questions are still in this browser — in memory AND in storage,
	// because a second tab, or the next document, reads the cell and not the variable.
	assert.deepEqual(f.log.state().questions.map((q) => q.text),
		['do you ship to Japan?', 'and to Korea?']);
	assert.equal(f.log.state().sent, 0);
	assert.equal(JSON.parse(f.cells.get(aiLogKey('site:acme'))).questions.length, 2);
	// The handle and the claim answer survive the failure too — they were never the network's.
	assert.equal(f.log.state().handle, 'conv-7');
	assert.equal(f.log.state().claim, true);

	// The next pagehide is the retry, under the SAME session id — which is why the server side
	// is idempotent on it rather than inserting a row per request.
	accept = true;
	const went = f.log.flush();
	assert.ok(went, 'the retry sent nothing');
	assert.equal(went.questions.length, 2);
	assert.equal(went.handle, 'conv-7');
});

test('D1: only a 2xx clears — a rejected fetch and a 404 both leave the questions where they are', async () => {
	for (const [name, answer] of [
		['a rejected fetch', () => Promise.reject(new Error('offline'))],
		['a 404 not_claimed', () => Promise.resolve(false)],
		['a 429', () => Promise.resolve(false)]
	]) {
		const f = logFixture({ send: () => answer() });
		f.log.question('is anybody there?', '/', null, '');
		assert.equal(await f.log.escalated('conv-9'), null, `${name} was read as a send`);
		assert.equal(f.log.state().questions.length, 1, `${name} destroyed the buffer`);
		assert.equal(f.log.state().sent, 0);
	}

	// And the 2xx — the one answer that does clear it, replay included.
	const ok = logFixture({ send: () => Promise.resolve(true) });
	ok.log.question('is anybody there?', '/', null, '');
	const went = await ok.log.escalated('conv-9');
	assert.ok(went, 'a 2xx did not clear the session');
	assert.equal(ok.log.state().questions.length, 0);
	assert.notEqual(ok.log.state().sid, went.session_id);
});

test('D1: a pagehide flush that the server later refuses is un-sent, not left marked told', async () => {
	let served = false;
	const f = logFixture({ send: () => Promise.resolve(served) });
	f.log.question('do you ship to Japan?', '/', null, '');
	await f.settle();

	// The pagehide itself cannot wait — it hands the request over and the document may be gone.
	assert.ok(f.log.flush(), 'the flush did not go out at all');
	assert.equal(f.log.state().sent, 1, 'queued means marked sent until we hear otherwise');
	await f.settle();
	// …and this document did survive (a bfcache restore), so the answer arrived: not stored.
	assert.equal(f.log.state().sent, 0, 'a refused send stayed marked as told');
	served = true;
	const again = f.log.flush();
	assert.equal(again.questions.length, 1, 'the second pagehide did not carry it');
	await f.settle();
	assert.equal(f.log.state().sent, 1);
	assert.equal(f.log.flush(), null, 'a stored session went a third time');
});

// ── review D2/D8 (2026-09-08, round 2):「we do not know」is not「there is no Inbox」 ──────────
//
// 🩸 THE FIELD THAT EXISTS TO SPLIT THOSE TWO WAS NEVER READ. Contract §一.1 answers a
// rate-limited probe with 200 `{claimed:false, throttled:true}` rather than 429, precisely so a
// coral that cannot ask does not write — and the coral flattened it back to `false`, which does
// not merely refuse to send: it EMPTIES this browser's buffer and caches the no for six hours.
// The probe shares the `read` bucket with a 15-second transcript poll, so on a busy site that is
// the ordinary path, and nothing anywhere would have gone red.

test('D2: the probe reads all four contract answers, and only two of them are answers', async () => {
	const saved = globalThis.fetch;
	try {
		const probe = async (body, ok = true) => {
			globalThis.fetch = async () => ({ ok, json: async () => body });
			return probeInboxClaim('https://feelreef.com', 'site', 'acme');
		};
		assert.equal(await probe({ ok: true, claimed: true }), true, 'a claimed site');
		assert.equal(await probe({ ok: true, claimed: false }), false, 'a KAITO-only site');
		// 🔴 The one the review found. It arrives DRESSED AS A NO — same `claimed:false` — and the
		// only thing telling it apart is the field this line reads.
		assert.equal(await probe({ ok: true, claimed: false, throttled: true }), null,
			'a throttled probe was read as「this site has no Inbox」');
		assert.equal(await probe({ ok: true, claimed: true, throttled: true }), null);
		assert.equal(await probe({ ok: false, reason: 'bad_kind' }, false), null);
		assert.equal(await probe({ ok: true }), null, 'a shape we cannot read is not a no either');
		globalThis.fetch = async () => { throw new TypeError('network'); };
		assert.equal(await probeInboxClaim('https://feelreef.com', 'site', 'acme'), null);
	} finally {
		globalThis.fetch = saved;
	}
});

test('D2: a throttled probe holds the questions, writes down nothing, and retries on the backoff', async () => {
	let answer = null; // 「we do not know」
	let probes = 0;
	const f = logFixture({ probeClaim: async () => (probes++, answer) });
	f.log.question('do you ship to Japan?', '/', null, '');
	await f.settle();

	assert.equal(probes, 1);
	assert.equal(f.log.state().claim, null, 'a non-answer was cached as an answer');
	assert.equal(f.log.state().questions.length, 1, 'a non-answer emptied the buffer');
	// Unknown is still not permission: nothing leaves until somebody actually says yes.
	assert.equal(f.log.flush(), null);
	assert.equal(f.sent.length, 0);

	// 🔴 AND IT IS BOUNDED (D8). The review measured one probe per question against a manifest
	// that promises at most one per six hours; eight more questions now cost none.
	for (let i = 0; i < 8; i++) f.log.question(`q${i}`, '/', null, '');
	await f.settle();
	assert.equal(probes, 1, 'a non-answer re-asked on every question');

	// A backoff, not a cache: it asks again five minutes later, and nothing was lost meanwhile.
	f.tick(AI_LOG_CLAIM_RETRY_MS + 1);
	answer = true;
	f.log.question('and to Korea?', '/', null, '');
	await f.settle();
	assert.equal(probes, 2);
	assert.equal(f.log.state().claim, true);
	const went = f.log.flush();
	assert.equal(went.questions.length, 10, 'the questions asked while we did not know were dropped');
	assert.equal(went.questions[0].text, 'do you ship to Japan?');

	// The shorter window belongs to not-knowing only — a definite answer still gets six hours.
	f.tick(AI_LOG_CLAIM_RETRY_MS + 1);
	f.log.question('one more', '/', null, '');
	await f.settle();
	assert.equal(probes, 2, 'a definite answer was re-asked inside its TTL');
	f.tick(AI_LOG_CLAIM_TTL_MS);
	f.log.question('and another', '/', null, '');
	await f.settle();
	assert.equal(probes, 3, 'the six-hour TTL never expired');
});

test('D2: a probe that never came back is the same non-answer, bounded the same way', async () => {
	let probes = 0;
	const f = logFixture({ probeClaim: async () => { probes++; throw new TypeError('network'); } });
	f.log.question('anyone there?', '/', null, '');
	await f.settle();
	assert.equal(f.log.state().claim, null);
	assert.equal(f.log.state().questions.length, 1, 'a network failure dropped the buffer');
	assert.equal(f.log.flush(), null);

	f.log.question('still anyone?', '/', null, '');
	await f.settle();
	assert.equal(probes, 1, 'a thrown probe re-asked immediately');
	f.tick(AI_LOG_CLAIM_RETRY_MS + 1);
	f.log.question('hello?', '/', null, '');
	await f.settle();
	assert.equal(probes, 2);
});

// ── review D10 (2026-09-08, round 2): the drop was honoured once, not every time ─────────────
//
// 🩸 The first `claimed:false` cleared the buffer; after that the six-hour cache took the early
// return and every question asked in those six hours accumulated in the visitor's browser — up
// to 20 × 500 characters, never sent, but HELD. The online guarantee held (a KAITO-only tenant
// received nothing) and the README's sentence — that an unclaimed answer drops what is buffered
// rather than「holding it against the day somebody claims the inbox」— did not.

test('D10: a site with no Inbox holds nothing, on every question and every page after the answer', async () => {
	let probes = 0;
	const f = logFixture({ probeClaim: async () => (probes++, false) });
	f.log.page('/');
	f.log.question('anyone there?', '/', null, '');
	await f.settle();
	assert.equal(probes, 1);
	assert.equal(f.log.state().questions.length, 0, 'the answer did not drop what was buffered');

	// A minute later, inside the six-hour cache — the review measured one question held here.
	f.tick(60_000);
	f.log.question('hello?', '/', null, '');
	f.log.question('is anyone reading this?', '/', null, '');
	await f.settle();
	assert.equal(probes, 1, 'a cached answer was re-asked');
	assert.equal(f.log.state().questions.length, 0, 'the questions are being held after all');
	assert.equal(JSON.parse(f.cells.get(aiLogKey('site:acme'))).questions.length, 0,
		'they are being held in storage, which is where they outlive the tab');
	assert.equal(f.log.flush(), null);
	assert.equal(f.sent.length, 0);

	// And the page sequence does not refill between questions either.
	f.log.page('/pricing');
	f.log.page('/contact');
	assert.deepEqual(f.log.state().pages, []);

	// The buffer comes back the moment somebody claims the inbox — that is what the TTL is for,
	// and the answer that arrives then is about the site, not retroactively about this visit.
	f.tick(AI_LOG_CLAIM_TTL_MS + 1);
	// A later mount, same browser, same clock — the answer is due to be asked again by now.
	const claimed = logFixture({ storage: f.storage, now: f.at, probeClaim: async () => true });
	claimed.log.question('now?', '/', null, '');
	await claimed.settle();
	assert.equal(claimed.log.state().questions.length, 1);
});

// ── review D7 (2026-09-08, round 2): a storage that stops taking writes ──────────────────────
//
// 🩸 The review asked three questions with a full quota and the buffer held ONE — the newest, on
// its own. Because every method re-reads the cell, a failed write meant the next read came back
// with the state from before the question that failed, over and over. The owner would have seen
// a visitor who asked once, which is indistinguishable from a visitor who did.

test('D7: a full quota keeps the session in memory, not the last question on its own', async () => {
	const cells = new Map();
	let full = false;
	const storage = {
		getItem: (k) => (cells.has(k) ? cells.get(k) : null),
		setItem: (k, v) => {
			if (full) throw new Error('QuotaExceededError');
			cells.set(k, v);
		}
	};
	const f = logFixture({ storage });
	f.log.page('/');
	f.log.question('第一題', '/', null, '');
	await f.settle();

	full = true; // the quota fills — subsequent writes throw, reads still work
	f.log.question('第二題', '/', null, '');
	f.log.question('第三題', '/', null, '');
	assert.deepEqual(f.log.state().questions.map((q) => q.text), ['第一題', '第二題', '第三題'],
		'the buffer fell back to what storage last accepted');
	const went = f.log.flush();
	assert.equal(went.questions.length, 3, 'a partial record went to the owner');

	// The caps still bound what memory holds —「keep the last N」is the same N as ever.
	for (let i = 0; i < AI_LOG_MAX_QUESTIONS + 5; i++) f.log.question(`q${i}`, '/', null, '');
	assert.equal(f.log.state().questions.length, AI_LOG_MAX_QUESTIONS);
	// …and what it cannot do is be shared: storage still holds the last thing it accepted.
	assert.equal(JSON.parse(cells.get(aiLogKey('site:acme'))).questions.length, 1);

	// When the store starts accepting writes again it is the source of truth again.
	full = false;
	f.log.question('後來', '/', null, '');
	const stored = JSON.parse(cells.get(aiLogKey('site:acme')));
	assert.equal(stored.questions.length, AI_LOG_MAX_QUESTIONS);
	assert.equal(stored.questions[stored.questions.length - 1].text, '後來');
});

// ── review D6 (2026-09-08, round 2): one browser, two tabs, one idempotency key ──────────────
//
// 🩸 `flush()` was the only method that did not start by re-reading storage, and the only one
// that reaches the network. The review opened two tabs on one localStorage: tab A's pagehide sent
// four questions, tab B's sent the two it had held since it mounted — same `session_id`, shorter
// body, and what the server does with a session that got SHORTER is not something this side can
// see. The fix is the line the other three methods already have.

/** Two mounts of the same tenant in the same browser — one storage, two in-memory states. */
function twoTabs() {
	const cells = new Map();
	const storage = {
		getItem: (k) => (cells.has(k) ? cells.get(k) : null),
		setItem: (k, v) => cells.set(k, v)
	};
	let clock = 1_700_000_000_000;
	let n = 0;
	const open = () => {
		const sent = [];
		const log = createAiLog({
			tenant: 'site:acme', kind: 'site', id: 'acme', storage,
			now: () => clock, newId: () => `sid-${++n}`,
			send: (p) => (sent.push(p), true),
			probeClaim: async () => true
		});
		return { log, sent };
	};
	return { open, cells, tick: (ms) => (clock += ms), settle: () => new Promise((r) => setTimeout(r, 0)) };
}

test('D6: a second tab flushes what the BROWSER holds, not what it happened to mount with', async () => {
	const browser = twoTabs();
	const a = browser.open();
	a.log.page('/');
	a.log.question('請問有現貨嗎', '/', null, '');
	a.log.question('可以退貨嗎', '/', null, '');

	// The visitor opens a second tab here. Its memory stops at these two questions for good.
	const b = browser.open();
	a.log.question('那有大尺碼嗎', '/', null, '');
	a.log.question('運費多少', '/', null, '');
	await browser.settle();

	// Tab B's pagehide fires first — the phone was backgrounded on that tab.
	const wentB = b.log.flush();
	assert.ok(wentB, 'the second tab sent nothing at all');
	assert.equal(wentB.questions.length, 4, 'the second tab sent a SHORTER body under the same key');
	assert.deepEqual(wentB.questions.map((q) => q.text),
		['請問有現貨嗎', '可以退貨嗎', '那有大尺碼嗎', '運費多少']);
	// It is the same session id either way — which is exactly why the shorter body was dangerous.
	assert.equal(wentB.session_id, 'sid-1');

	// And tab A's pagehide now costs nothing: the browser's own record says it already went.
	assert.equal(a.log.flush(), null, 'the same four questions travelled twice');
	assert.equal(a.sent.length, 0);
});

test('D6: the claim answer another tab learned is honoured too, and an idle session is not rotated by a flush', async () => {
	const browser = twoTabs();
	const a = browser.open();
	a.log.page('/');
	const b = browser.open();
	b.log.page('/contact'); // a mount records its page view, which is how a tab joins the session
	a.log.question('anyone there?', '/', null, '');
	await browser.settle(); // tab A's probe answers yes and writes it down

	// Tab B never probed — its own `state.claim` is what it mounted with, which is null.
	assert.equal(b.log.state().claim, null);
	const went = b.log.flush();
	assert.ok(went, 'the second tab held questions it was already allowed to send');
	assert.equal(went.questions[0].text, 'anyone there?');

	// 🔴 A flush reads the session, it does not decide whether the session is over: thirty idle
	// minutes later the unsent questions still go, rather than being rotated away unsent.
	const c = twoTabs();
	const one = c.open();
	one.log.question('do you ship to Japan?', '/', null, '');
	await c.settle();
	c.tick(AI_LOG_IDLE_MS + 1);
	const late = one.log.flush();
	assert.ok(late, 'a pagehide after an idle gap threw the questions away instead of sending them');
	assert.equal(late.questions.length, 1);
});

// ── review D3 (2026-09-08, round 2): the loudest rule in this file had no ruler ──────────────
//
// 🩸「The machine's answers are never sent」is written in four places — this file's header, the
// README, the manifest, contract §一.3 — and the review put the answer on the wire with a
// two-token edit at the one call site (`answer.source_url` → `answer.text`) while all hundred
// tests stayed green. Existence assertions cannot see an EXTRA thing: every 54 test above asks
// whether a value it names is present, and none of them ever asked what ELSE the body carries.
//
// So the key sets are enumerated here, against the contract's own list spelled out literally
// rather than read back out of the code, and the BYTES a real `mount()` sends are measured in
// mount.test.mjs. A field added to the buffer, to a question row, or to the wire body without
// being added to the contract turns one of the two red.

const PLANTED_ANSWER = 'THE-MACHINE-SAID-THIS';

test('D3: a question row is BUILT from the whitelist — five fields, and nothing that rode along', () => {
	assert.deepEqual([...AI_QUESTION_FIELDS], ['text', 'page', 'hit', 'lang', 'at']);

	// The answer under every name a future refactor might hang off the same object, plus the
	// transcript it came from — the shapes the review's M21/M22 mutations added.
	const [row] = capAiQuestions([{
		text: 'do you ship to Japan?', page: '/pricing', hit: 'https://shop.example/faq',
		lang: 'ja-jp', at: 7,
		answer: PLANTED_ANSWER,
		text_answer: PLANTED_ANSWER,
		kaito: { kind: 'grounded', text: PLANTED_ANSWER },
		messages: [{ role: 'assistant', body: PLANTED_ANSWER }]
	}]);
	assert.deepEqual(Object.keys(row), ['text', 'page', 'hit', 'lang', 'at']);
	assert.equal(JSON.stringify(row).includes(PLANTED_ANSWER), false,
		'a field nobody whitelisted travelled with the row');
});

test('D3: a hit is a URL, so the answer cannot be handed in as one', () => {
	// 🔴 THIS IS THE STRUCTURAL HALF. `hit` is the only argument of `question()` that could hold
	// the machine's words, and the fix is not「remember to pass source_url」— it is that prose is
	// not a URL. The review's own mutation, spelled out:
	const asAnswer = capAiQuestions([{ text: 'q', page: '/', at: 1,
		hit: 'We ship to Japan on Tuesdays. See our shipping page for the cut-off times.' }]);
	assert.equal(asAnswer[0].hit, null, 'a sentence became a hit');
	// Including one that quotes a URL, which is what a cited answer's text looks like.
	const withUrl = capAiQuestions([{ text: 'q', page: '/', at: 1,
		hit: 'Yes — see https://shop.example/faq#stock for the current stock.' }]);
	assert.equal(withUrl[0].hit, null);
	// A real citation still travels, whole.
	assert.equal(capAiQuestions([{ hit: 'https://shop.example/faq#stock' }])[0].hit,
		'https://shop.example/faq#stock');
	assert.equal(capAiQuestions([{ hit: 'javascript:alert(1)' }])[0].hit, null);
	assert.equal(capAiQuestions([{ hit: '/faq' }])[0].hit, null, 'a hit is the PUBLIC url, absolute');
});

test('D3: the wire body carries the contract keys and no field of the buffer rides along', () => {
	assert.deepEqual([...AI_SESSION_FIELDS],
		['kind', 'id', 'session_id', 'pages', 'questions', 'handle']);

	// A buffer holding everything the log holds today, plus everything a future field might be.
	const body = aiSessionPayload('site', 'acme', {
		sid: 'sid-1', started: 1, last: 2, sent: 1, claim: true, claimAt: 3,
		pages: ['/pricing'], handle: null,
		questions: [{ text: 'can I return it?', page: '/pricing', hit: null, lang: '', at: 4 }],
		transcript: [{ role: 'assistant', text: PLANTED_ANSWER }],
		lastAnswer: PLANTED_ANSWER
	});
	assert.deepEqual(Object.keys(body).sort(),
		['id', 'kind', 'pages', 'questions', 'session_id'],
		'the body grew a key the contract does not name');
	const json = JSON.stringify(body);
	assert.equal(json.includes(PLANTED_ANSWER), false);
	for (const own of ['claim', 'claimAt', '"sent"', 'started', '"last"', '"sid"', 'transcript']) {
		assert.equal(json.includes(own), false, `the buffer's own \`${own}\` reached the wire`);
	}

	// `handle` is the sixth key and appears only when this session reached a person.
	const escalated = aiSessionPayload('site', 'acme',
		{ sid: 'sid-1', pages: [], questions: [], handle: 'conv-7' });
	assert.deepEqual(Object.keys(escalated).sort(),
		['handle', 'id', 'kind', 'pages', 'questions', 'session_id']);
});
