// query-redirects.mjs — the canonicaliser table, the grammar, and every refusal by name (reef#1882).
//
// 🔴 The table is the contract three readers share (the platform that writes `_query-redirects.md`,
// the build that compiles it, the worker that matches it). A row here is a spelling a REAL request
// can arrive in; each is asserted to land on exactly one key, and the ones that must NOT land are
// asserted null — a canonicaliser that only has positive cases cannot tell "same key" from
// "everything is the same key".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	canonPath, canonPathDetail, canonQuery, canonQueryDetail, targetDetail,
	parseQueryRedirects, compile, countRules, lookupQueryRedirect, QueryRedirectError,
	QUERY_REDIRECTS_MAX_RULES, QUERY_REDIRECTS_MAX_BYTES, QUERY_REDIRECTS_MAX_CHARS, QUERY_REDIRECTS_MAX_PAIRS
} from './query-redirects.mjs';

// ── canonPath ───────────────────────────────────────────────────────────────────────────────────

test('canonPath: one key for every spelling of a path', () => {
	const rows = [
		['/product.php', '/product.php'],
		['/product.php/', '/product.php'],                 // one trailing slash
		['/product.php/index.html', '/product.php'],       // explicit index file
		['/', '/'],
		['/index.html', '/'],
		['/a/../product.php', '/product.php'],             // dot segments resolve
		['/%E7%94%A2%E5%93%81.php', '/產品.php'],           // encoded UTF-8 → decoded key
		['/產品.php', '/產品.php'],                         // already decoded
		['/e\u0301.php', '/é.php'],                         // NFD → NFC
		['/%C3%A9.php', '/é.php'],
		['/a%25b', '/a%b'],                                 // a literal % arrives only as %25
		['/A.PHP', '/A.PHP'],                               // case preserved
	];
	for (const [input, key] of rows) assert.equal(canonPath(input), key, input);
});

test('canonPath: refusals, by name', () => {
	const rows = [
		['', 'path_not_site_relative'],
		['product.php', 'path_not_site_relative'],
		['//evil.example/x', 'path_not_site_relative'],
		['/a%2Fb', 'encoded_separator'],
		['/a%2fb', 'encoded_separator'],
		['/a%5Cb', 'encoded_separator'],
		['/a\\b', 'backslash'],
		['/a%5cb', 'encoded_separator'],
		['/a b', 'control_char'],
		['/a%20b', 'control_char'],
		['/a\tb', 'control_char'],
		['/a%09b', 'control_char'],
		['/a%00b', 'control_char'],
		['/a%zz', 'bad_encoding'],
		['/a%E7', 'bad_encoding'],                         // not UTF-8: no raw fallback on PATHS
		['/a//b', 'empty_segment'],
		['/a//', 'empty_segment'],
		['/a?b', 'path_has_query'],
		['/a#b', 'path_has_query'],
	];
	for (const [input, code] of rows) {
		assert.equal(canonPath(input), null, input + ' must be refused');
		assert.equal(canonPathDetail(input).code, code, input);
	}
});

// ── canonQuery ──────────────────────────────────────────────────────────────────────────────────

test('canonQuery: one key for every spelling of a query', () => {
	const rows = [
		['?cid=12', 'cid=12'],
		['cid=12', 'cid=12'],                               // leading ? optional
		['?b=2&a=1', 'a=1&b=2'],                            // order-insensitive
		['?a=1&b=2', 'a=1&b=2'],
		['?a', 'a='],                                       // ?a and ?a= are one key
		['?a=', 'a='],
		['?&a=1&&', 'a=1'],                                 // empty pieces vanish
		['?q=hello+world', 'q=hello+world'],                // + is a space …
		['?q=hello%20world', 'q=hello+world'],              // … and so is %20
		['?q=a%2Bb', 'q=a%2Bb'],                            // a literal + stays encoded
		['?n=caf%C3%A9', 'n=caf%C3%A9'],
		['?n=café', 'n=caf%C3%A9'],                         // a decoded name/value re-encodes as UTF-8
		['?n=cafe%CC%81', 'n=caf%C3%A9'],                   // NFD → NFC
		['?cid=12&cid=12', 'cid=12&cid=12'],                // duplicates are kept (multiset)
		['?cid=12&cid=11', 'cid=11&cid=12'],                // … and sorted by value within a name
		['?%63id=12', 'cid=12'],                            // an encoded name decodes
		['?a=1=2', 'a=1%3D2'],                              // first = separates; the rest is value
		['?a%3Db=1', 'a%3Db=1'],                            // an encoded = in the NAME stays encoded
	];
	for (const [input, key] of rows) assert.equal(canonQuery(input), key, input);
});

test('canonQuery: case-sensitive parameters', () => {
	assert.notEqual(canonQuery('?cid=12'), canonQuery('?CID=12'));
	assert.notEqual(canonQuery('?cid=ab'), canonQuery('?cid=AB'));
});

test('canonQuery: 🔴 Big5 (non-UTF-8) pairs compare raw, hex uppercased, and never become U+FFFD', () => {
	// `%B7%7B` is Big5 for 林 — what an old Taiwanese PHP site puts in ?name=.
	assert.equal(canonQuery('?name=%B7%7B'), 'name=%B7%7B');
	assert.equal(canonQuery('?name=%b7%7b'), 'name=%B7%7B');
	assert.equal(canonQuery('?name=%B7%7B+%B7%7B'), 'name=%B7%7B%20%B7%7B');   // + → %20 in raw form
	assert.ok(!canonQuery('?name=%B7%7B').includes('\uFFFD'));
	// URLSearchParams — the thing this replaces — would have minted U+FFFD here and never matched.
	assert.ok(new URLSearchParams('?name=%B7%7B').get('name').includes('\uFFFD'), 'the premise: URLSearchParams loses the bytes');
	// A raw pair is atomic: the decodable name rides raw with its undecodable value. Other pairs on the
	// same query still decode normally, and the whole thing still sorts.
	assert.equal(canonQuery('?z=1&name=%b7%7b&a=caf%c3%a9'), 'a=caf%C3%A9&name=%B7%7B&z=1');
	// 🔴 A literal U+FFFD that was sent as such (valid UTF-8) is just a character — no raw fallback.
	assert.equal(canonQuery('?x=%EF%BF%BD'), 'x=%EF%BF%BD');
});

test('canonQuery: refusals, by name', () => {
	const rows = [
		['?a=%zz', 'bad_encoding'],
		['?a=%4', 'bad_encoding'],
		['?%zz=1', 'bad_encoding'],
		['?name=%B7%7B&x=%zz', 'bad_encoding'],   // a malformed escape is not "legacy bytes"
		['?a=1#f', 'fragment'],
		['?a=%09', 'control_char'],
		['?a=\u0001', 'control_char'],
		['?a=%00', 'control_char'],
	];
	for (const [input, code] of rows) {
		assert.equal(canonQuery(input), null, input + ' must be refused');
		assert.equal(canonQueryDetail(input).code, code, input);
	}
	// Empty is not a refusal — it is '' — and compile() is what turns '' into `empty_query`.
	assert.equal(canonQuery('?'), '');
	assert.equal(canonQuery(''), '');
	assert.equal(canonQuery('?&&'), '');
});

test('the canonicalisers are fixed points: canon(canon(x)) === canon(x)', () => {
	for (const p of ['/product.php/', '/%E7%94%A2%E5%93%81.php', '/e\u0301.php', '/a/../b/index.html']) {
		assert.equal(canonPath(canonPath(p)), canonPath(p), p);
	}
	for (const q of ['?b=2&a=1', '?q=hello%20world', '?name=%b7%7b', '?n=cafe%CC%81', '?a']) {
		assert.equal(canonQuery('?' + canonQuery(q)), canonQuery(q), q);
	}
});

// ── targets ─────────────────────────────────────────────────────────────────────────────────────

test('targetDetail: a to is site-relative or it is refused', () => {
	for (const ok of ['/', '/products/widget', '/blog/hello/', '/s?q=1', '/p#top', '/%E7%94%A2%E5%93%81']) {
		assert.equal(targetDetail(ok).ok, true, ok);
	}
	const rows = [
		['', 'to_not_site_relative'],
		['products/widget', 'to_not_site_relative'],
		['//evil.example/', 'to_not_site_relative'],
		['https://evil.example/', 'to_not_site_relative'],
		['/x://y', 'to_not_site_relative'],
		['/a\\b', 'to_not_site_relative'],
		['/a b', 'to_not_site_relative'],
		['/a%00', 'to_not_site_relative'],
		['/a/*', 'to_not_site_relative'],
		['/a/:slug', 'to_not_site_relative'],
		['/a%zz', 'bad_encoding'],
	];
	for (const [input, code] of rows) {
		assert.equal(targetDetail(input).ok, false, input);
		assert.equal(targetDetail(input).code, code, input);
	}
});

// node:assert's throws() returns nothing, so the error is caught by hand to read its code/line.
const caught = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected a throw'); };
const refused = (text, opts) => {
	const e = caught(() => compile(text, opts));
	assert.ok(e instanceof QueryRedirectError, 'a QueryRedirectError, got ' + e);
	return e;
};

// ── grammar ─────────────────────────────────────────────────────────────────────────────────────

test('parseQueryRedirects: three columns, # comments, blank lines, CRLF, BOM', () => {
	const text = '\uFEFF# query-string redirects\r\n\r\n/product.php?cid=12        /products/widget     301\r\n  # indented comment\n/?p=123\t/blog/hello\t301\n';
	assert.deepEqual(parseQueryRedirects(text), [
		{ line: 3, from: '/product.php?cid=12', to: '/products/widget', status: '301' },
		{ line: 5, from: '/?p=123', to: '/blog/hello', status: '301' },
	]);
	assert.deepEqual(parseQueryRedirects(''), []);
	assert.deepEqual(parseQueryRedirects('# only a comment\n'), []);
});

test('parseQueryRedirects: a line that is not three columns is bad_line, with its line number', () => {
	const e = caught(() => parseQueryRedirects('/a?x=1 /b 301\n/a?x=2 /b\n'));
	assert.ok(e instanceof QueryRedirectError);
	assert.equal(e.code, 'bad_line');
	assert.equal(e.line, 2);
	assert.equal(caught(() => parseQueryRedirects('/a?x=1 /b 301 # trailing')).code, 'bad_line');
});

// ── compile ─────────────────────────────────────────────────────────────────────────────────────

test('compile: the design shape, keys canonical and sorted at both levels', () => {
	const map = compile([
		'# comment',
		'/product.php/?cid=12   /products/widget 301',
		'/product.php?b=2&a=1   /ab 301',
		'/?p=123                /blog/hello 301',
		'/%E7%94%A2%E5%93%81.php?id=1  /products/one 301',
	].join('\n'));
	assert.deepEqual(map, {
		v: 1,
		byPath: {
			'/': { 'p=123': '/blog/hello' },
			'/product.php': { 'a=1&b=2': '/ab', 'cid=12': '/products/widget' },
			'/產品.php': { 'id=1': '/products/one' },
		},
	});
	assert.deepEqual(Object.keys(map.byPath), ['/', '/product.php', '/產品.php']);
	assert.deepEqual(Object.keys(map.byPath['/product.php']), ['a=1&b=2', 'cid=12']);
	assert.equal(countRules(map), 4);
});

test('compile: the same rules in a different order are the same bytes', () => {
	const a = compile('/a?x=1 /1 301\n/b?y=2 /2 301\n/a?x=0 /0 301\n');
	const b = compile('/b?y=2 /2 301\n/a?x=0 /0 301\n/a?x=1 /1 301\n');
	assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('compile: an empty or comment-only file is an empty map', () => {
	assert.deepEqual(compile(''), { v: 1, byPath: {} });
	assert.deepEqual(compile('# nothing yet\n'), { v: 1, byPath: {} });
	assert.equal(countRules(compile('')), 0);
});


test('compile: refusals, by name, with the line they are about', () => {
	const rows = [
		['/a /b 301', 'empty_query'],                        // a path rule belongs in _redirects
		['/a? /b 301', 'empty_query'],
		['/a?&& /b 301', 'empty_query'],
		['/a?x=1#f /b 301', 'fragment'],
		['/a?x=1 /b 302', 'unsupported_status'],
		['/a?x=1 /b 301!', 'unsupported_status'],
		['/a%2Fb?x=1 /b 301', 'encoded_separator'],
		['/a%5Cb?x=1 /b 301', 'encoded_separator'],
		['/a%zz?x=1 /b 301', 'bad_encoding'],
		['/a?x=%zz /b 301', 'bad_encoding'],
		['/a%E7?x=1 /b 301', 'bad_encoding'],
		['/a%09b?x=1 /b 301', 'control_char'],
		['/a?x=%00 /b 301', 'control_char'],
		['/a//b?x=1 /b 301', 'empty_segment'],
		['//evil?x=1 /b 301', 'path_not_site_relative'],
		['a?x=1 /b 301', 'path_not_site_relative'],
		['/a?x=1 https://evil.example/ 301', 'to_not_site_relative'],
		['/a?x=1 //evil.example/ 301', 'to_not_site_relative'],
		['/a?x=1 b 301', 'to_not_site_relative'],
		['/a?x=1 /b/* 301', 'to_not_site_relative'],
		['/a?x=1 /b%zz 301', 'bad_encoding'],
		['/__reef/inbox?x=1 /b 301', 'reserved_path'],
		['/_yt/abcdefghijk.jpg?x=1 /b 301', 'reserved_path'],
	];
	for (const [line, code] of rows) {
		const e = refused('# first line is a comment\n' + line + '\n');
		assert.equal(e.code, code, line);
		assert.equal(e.line, 2, line + ' should be reported on line 2');
	}
});

test('compile: duplicates and collisions — same canonical from twice is refused, whatever the spelling', () => {
	let e = refused('/a?x=1 /b 301\n/a?x=1 /b 301\n');
	assert.equal(e.code, 'duplicate_rule'); assert.equal(e.line, 2);
	e = refused('/a?x=1 /b 301\n/a?x=1 /c 301\n');
	assert.equal(e.code, 'conflicting_rule'); assert.equal(e.line, 2);
	// Different spellings, one key: order, trailing slash, + vs %20, hex case, NFD.
	e = refused('/a?x=1&y=hello+world /b 301\n/a/?y=hello%20world&x=1 /c 301\n');
	assert.equal(e.code, 'conflicting_rule');
	e = refused('/a?n=%B7%7B /b 301\n/a?n=%b7%7b /c 301\n');
	assert.equal(e.code, 'conflicting_rule');
	e = refused('/a?n=caf%C3%A9 /b 301\n/a?n=cafe%CC%81 /c 301\n');
	assert.equal(e.code, 'conflicting_rule');
	// A to with its own query is allowed …
	assert.equal(compile('/a?x=1 /s?q=1 301\n').byPath['/a']['x=1'], '/s?q=1');
	// … unless it is itself a source (a 301 must land, not hop) — in any spelling, either order.
	e = refused('/a?x=1 /b?y=1 301\n/b?y=1 /c 301\n');
	assert.equal(e.code, 'chain'); assert.equal(e.line, 1);
	e = refused('/b?y=1 /c 301\n/a?x=1 /b/?y=1 301\n');
	assert.equal(e.code, 'chain'); assert.equal(e.line, 2);
	e = refused('/a?x=1 /a?x=1 301\n');
	assert.equal(e.code, 'chain');
	// A to on a source PATH without that query is not a chain: /product.php?cid=12 → /product.php
	// is "drop the parameter", and the bare path is served by ASSETS.
	assert.equal(compile('/product.php?cid=12 /product.php 301\n').byPath['/product.php']['cid=12'], '/product.php');
});

test('compile: reserved paths from the caller (storefronts as prefixes, buyer pages exact)', () => {
	const opts = { reservedPrefixes: ['/shop', '/zh-tw/shop/'], reservedPaths: ['/account'] };
	for (const from of ['/shop?x=1', '/shop/?x=1', '/shop/item?x=1', '/zh-tw/shop?x=1', '/zh-tw/shop/item?x=1', '/account?x=1', '/account/?x=1']) {
		assert.equal(refused(from + ' /b 301\n', opts).code, 'reserved_path', from);
	}
	// Siblings are not reserved: /shopping is not under /shop, /account/x is not the buyer page.
	for (const from of ['/shopping?x=1', '/shops?x=1', '/account/history?x=1']) {
		assert.equal(countRules(compile(from + ' /b 301\n', opts)), 1, from);
	}
});

test('compile: caps are fatal, not truncating', () => {
	const lines = (n) => Array.from({ length: n }, (_, i) => '/p?id=' + i + ' /t/' + i + ' 301').join('\n');
	assert.equal(countRules(compile(lines(QUERY_REDIRECTS_MAX_RULES))), QUERY_REDIRECTS_MAX_RULES);
	const e = refused(lines(QUERY_REDIRECTS_MAX_RULES + 1));
	assert.equal(e.code, 'too_many_rules');
	assert.equal(e.line, 0, 'about the file, not a line');

	const long = 'x'.repeat(QUERY_REDIRECTS_MAX_CHARS);
	assert.equal(countRules(compile('/p?id=' + long.slice(6) + ' /t 301')), 1, 'exactly at the cap is fine');
	assert.equal(refused('/p?id=' + long.slice(5) + ' /t 301').code, 'rule_too_long');
	assert.equal(refused('/p?id=1 /' + long + ' 301').code, 'rule_too_long');

	// Under the rule cap, over the byte cap: 100 rules of ~900-char to's ≈ 90 KB.
	const fat = Array.from({ length: 100 }, (_, i) => '/p?id=' + i + ' /' + 'y'.repeat(900) + '/' + i + ' 301').join('\n');
	const big = refused(fat);
	assert.equal(big.code, 'map_too_large');
	assert.ok(big.message.includes(String(QUERY_REDIRECTS_MAX_BYTES)));
});

// ── the worker's lookup ─────────────────────────────────────────────────────────────────────────

test('lookupQueryRedirect: exact multiset hit, in any spelling; everything else null', () => {
	const { byPath } = compile('/product.php?cid=12 /products/widget 301\n/?p=123 /blog/hello 301\n/big5.php?name=%B7%7B /people/lin 301\n');
	assert.equal(lookupQueryRedirect('/product.php', '?cid=12', byPath), '/products/widget');
	assert.equal(lookupQueryRedirect('/product.php/', '?cid=12', byPath), '/products/widget');
	assert.equal(lookupQueryRedirect('/product.php/index.html', '?cid=12', byPath), '/products/widget');
	assert.equal(lookupQueryRedirect('/product.php', '?cid=%31%32', byPath), '/products/widget');
	assert.equal(lookupQueryRedirect('/product.php', '?%63id=12', byPath), '/products/widget');
	assert.equal(lookupQueryRedirect('/', '?p=123', byPath), '/blog/hello');
	assert.equal(lookupQueryRedirect('/index.html', '?p=123', byPath), '/blog/hello');
	assert.equal(lookupQueryRedirect('/big5.php', '?name=%b7%7b', byPath), '/people/lin');
	// Not hits: another value, an extra parameter (exact multiset in v1), no query, another path,
	// a query the canonicaliser refuses, the parameter in another case.
	assert.equal(lookupQueryRedirect('/product.php', '?cid=13', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?cid=12&utm_source=x', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?cid=12&cid=12', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?', byPath), null);
	assert.equal(lookupQueryRedirect('/other.php', '?cid=12', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?cid=%zz', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?CID=12', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?cid=12', null), null);
	// Prototype names are not keys.
	assert.equal(lookupQueryRedirect('/constructor', '?x=1', byPath), null);
	assert.equal(lookupQueryRedirect('/product.php', '?constructor', byPath), null);
});

// ── tile#158 r2 (Codex review) ──────────────────────────────────────────────────────────────────

test('P1 targetDetail: a raw non-ASCII target is baked as an ASCII, percent-encoded Location', () => {
	const rows = [
		['/產品', '/%E7%94%A2%E5%93%81'],
		['/產品?q=中#段', '/%E7%94%A2%E5%93%81?q=%E4%B8%AD#%E6%AE%B5'],
		// Already-encoded escapes and reserved characters are left exactly as written.
		['/%E7%94%A2%E5%93%81', '/%E7%94%A2%E5%93%81'],
		['/a%2Fb?x=1&y=2;z=3', '/a%2Fb?x=1&y=2;z=3'],
		['/café%20au', '/caf%C3%A9%20au'],
	];
	for (const [input, want] of rows) {
		const r = targetDetail(input);
		assert.equal(r.ok, true, input);
		assert.equal(r.value, want, input);
		assert.match(r.value, /^[\x21-\x7E]+$/, 'header-safe: ' + input);
	}
	// A lone surrogate has no UTF-8 spelling; it is refused by name, not baked.
	assert.equal(targetDetail('/a\uD800').code, 'bad_encoding');
	// The compiled map carries the encoded spelling, so the worker never sees a raw CJK Location.
	assert.deepEqual(compile('/a?x=1 /產品 301\n').byPath, { '/a': { 'x=1': '/%E7%94%A2%E5%93%81' } });
	// Raw and encoded spellings of one target are the same target (duplicate, not conflict).
	assert.throws(() => compile('/a?x=1 /產品 301\n/a?x=1 /%E7%94%A2%E5%93%81 301\n'), (e) => e.code === 'duplicate_rule');
});

test('P2 canonQueryDetail: an encoded control byte is refused even inside a non-UTF-8 (Big5) pair', () => {
	for (const input of ['?name=%B7%7B%00', '?name=%B7%7B%0A', '?name=%b7%7b%0a', '?name=%B7%7B%7F', '?name=%B7%7B%1f', '?%00%B7%7B=x']) {
		const r = canonQueryDetail(input);
		assert.equal(r.ok, false, input);
		assert.equal(r.code, 'control_char', input);
	}
	// Big5 trail bytes in 0x80–0x9F are NOT controls in a raw pair — 林 is still a key.
	assert.equal(canonQuery('?name=%B7%7B'), 'name=%B7%7B');
	assert.equal(canonQuery('?name=%A4%80'), 'name=%A4%80');
	assert.throws(() => compile('/a?name=%B7%7B%00 /b 301\n'), (e) => e.code === 'control_char' && e.line === 1);
	assert.throws(() => compile('/a?name=%B7%7B%0A /b 301\n'), (e) => e.code === 'control_char' && e.line === 1);
});

test('P2 canonQueryDetail: parsing stops after the pair cap', () => {
	const r = canonQueryDetail('?' + Array.from({ length: QUERY_REDIRECTS_MAX_PAIRS + 1 }, (_, i) => 'k' + i + '=1').join('&'));
	assert.equal(r.ok, false);
	assert.equal(r.code, 'too_many_pairs');
	assert.equal(canonQueryDetail('?' + Array.from({ length: QUERY_REDIRECTS_MAX_PAIRS }, (_, i) => 'k' + i + '=1').join('&')).ok, true);
});

test('P2 lookupQueryRedirect: a search longer than any spelling of a key on that path is not parsed', () => {
	const { byPath } = compile('/product.php?cid=12 /products/widget 301\n');
	// Every spelling of the key still hits, including the longest: each byte percent-encoded.
	assert.equal(lookupQueryRedirect('/product.php', '?%63%69%64=%31%32', byPath), '/products/widget');
	assert.equal(lookupQueryRedirect('/product.php', '?cid=12&', byPath), '/products/widget');
	// The key padded with a megabyte of empty pairs used to canonicalise back onto the key and 301.
	assert.equal(lookupQueryRedirect('/product.php', '?cid=12' + '&'.repeat(1 << 20), byPath), null);
});
