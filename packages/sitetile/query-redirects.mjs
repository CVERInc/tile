// sitetile — query-string redirects: ONE canonicaliser, ONE grammar, ONE compiled shape (reef#1882).
//
// `_redirects` cannot match a query string (Cloudflare lists `?` rules under "not supported", and
// our own readers refuse a `?` in `from`), so a site migrating off `/product.php?cid=12` or
// WordPress's `/?p=123` has no server-side 301 for the links it already has out in the world. This
// module is the engine half of the answer: a site's IR carries `_query-redirects.md` in the same
// three-column grammar as `_redirects` (with `from` allowed to carry `?k=v`), the build compiles it
// into a map baked into the site's `_worker.js`, and the worker answers an exact hit with a 301
// BEFORE it consults the static assets.
//
// 🔴 PURE AND IMPORT-FREE, like site-core.js, and for a harder reason: this file is concatenated
// INTO the emitted worker (emit-shop-function.mjs), vendored into the platform that writes the IR
// file, and run by the build that compiles it. Three readers, the same bytes — never a "MUST match"
// comment between a writer's spelling and a reader's. Only web-platform globals are used (URL,
// URLSearchParams, TextEncoder, String#normalize), all of which Workers and Node share.
//
// ── Canonical forms ─────────────────────────────────────────────────────────────────────────────
// canonPath:  `new URL(path, base).pathname` (dot segments resolved, stray chars escaped), then ONE
//             percent-decode, NFC, strip a trailing `/index.html`, then ONE trailing `/` (root stays
//             `/`). The map key is the DECODED spelling: `/產品.php`, not `/%E7%94%A2%E5%93%81.php`.
//             Decoding once is unambiguous (a literal `%` can only arrive as `%25`), so every
//             spelling a request can arrive in lands on one key. Case preserved.
// canonQuery: split on `&`, `+` → space, ONE percent-decode per name and value, NFC, CASE-SENSITIVE
//             (PHP/WordPress parameters are), pairs sorted by name then value (duplicates kept,
//             order-insensitive), re-serialised the way URLSearchParams#toString does. `?a` and
//             `?a=` are one key. A pair that is not UTF-8 after decoding — 🔴 old Taiwanese PHP
//             sites carry Big5 in query strings (`?name=%B7%7B`) — is compared in RAW percent form
//             (hex uppercased, `+` → `%20`) instead of being turned into U+FFFD and never matching.
//
// Both return `null` on anything they refuse; the *Detail variants say why, by name, for compile().
// The worker only ever calls the null-returning ones: a request it cannot canonicalise is simply
// not a hit, and falls through exactly as it did before this file existed.

export const QUERY_REDIRECTS_FILE = '_query-redirects.md';
export const QUERY_REDIRECTS_VERSION = 1;

// Caps — FATAL at compile, never truncating. A map that silently dropped rule 501 would ship a
// site that lost a 301 with the build green, which is the one outcome this whole file is against.
//   MAX_RULES  500   — the platform's own `add_redirect` cap for path rules; one site's legacy
//                      permalink set is hundreds, not thousands (a 10k-post WordPress blog maps by
//                      pattern, not by enumerating ?p= ids — that is the client island's job).
//   MAX_BYTES  64 KB — the serialised map's UTF-8 size. 500 rules × ~130 B ≈ 65 KB, so the two caps
//                      bind at about the same place for ordinary rules; a map of 1,000-char rules
//                      hits this one first. The worker it lands in is already several hundred KB
//                      and the Workers script ceiling is megabytes, so this is a sanity bound on
//                      the IR file, not a platform limit.
//   MAX_CHARS  1000  — per `from` and per `to`, the platform's ADD_REDIRECT_MAX_CHARS.
export const QUERY_REDIRECTS_MAX_RULES = 500;
export const QUERY_REDIRECTS_MAX_BYTES = 64 * 1024;
export const QUERY_REDIRECTS_MAX_CHARS = 1000;

// Request-side bounds — the caps above constrain the BAKED map, these constrain what a request can
// make the worker do (tile#158 r2: a 4 MB query on a mapped path cost ~755 ms and ~110 MiB before
// it missed). Both make a request a MISS, never an error.
//   MAX_PAIRS  500   — canonQuery stops parsing past this many non-empty pairs. A `from` is at most
//                      MAX_CHARS = 1000 characters and a pair needs a character plus its `&`, so no
//                      rule can hold more; a request with more cannot equal any key.
//   MAX_SEARCH 16 KiB — lookupQueryRedirect refuses, without parsing, a `url.search` longer than
//                      this. FIXED, and derived from MAX_CHARS, not from the map: 🩸 r2 derived it
//                      as 4 × the longest key, and equivalent spellings have no such multiplier —
//                      empty pieces are unbounded (`?a&&&&&&&&` is 10 chars for the 2-char key
//                      `a=`) and NFC is not length-preserving (`?q=KK` in KELVIN SIGN is 21 chars
//                      for `q=KK`) — so accepted sources missed (tile#158 r3). The arithmetic: a
//                      `from` is ≤ 1000 UTF-16 units; the browser serialises each unit as at most
//                      12 characters (an astral character is 2 units → 4 UTF-8 bytes → 12; a BMP
//                      one is 1 unit → ≤ 3 bytes → ≤ 9; ASCII ≤ 3), so the search of EVERY accepted
//                      source, as a browser sends it, is ≤ 12 × 1000 + `?` = 12,001 ≤ 16,384.
//                      🔴 The contract: every accepted source matches in its browser spelling; an
//                      EQUIVALENT spelling longer than the ceiling (the key padded with 16 K of `&`)
//                      is not parsed and falls through to ASSETS. Measured: a 16 KiB search in the
//                      worst shapes (all `&`; 500 pairs of %XX UTF-8; pairs past the cap)
//                      canonicalises in well under 10 ms (query-redirects.test.mjs asserts it).
export const QUERY_REDIRECTS_MAX_PAIRS = 500;
export const QUERY_REDIRECTS_MAX_SEARCH = 16 * 1024;

// Status column: this file compiles 301s and nothing else. A 302 would be a redirect nobody
// wanted search engines to remember, and the ticket's whole point is the opposite.
export const QUERY_REDIRECTS_STATUS = '301';

// Paths the worker answers ITSELF, on every site, before anything static — a rule here could never
// land on the page it names. The emitter adds the per-site set (storefronts, buyer pages) on top.
export const QUERY_REDIRECTS_RESERVED_PREFIXES = ['/__reef/', '/_yt/'];

// Every refusal has a name. `code` is the stable identifier; `line` is 1-based when the refusal is
// about one line of the file, 0 when it is about the file as a whole.
export class QueryRedirectError extends Error {
	constructor(code, message, line = 0) {
		super((line ? 'line ' + line + ': ' : '') + code + ': ' + message);
		this.name = 'QueryRedirectError';
		this.code = code;
		this.line = line;
	}
}

const BASE = 'http://site.invalid';
const CONTROL_OR_SPACE = /[\u0000- \u007F-\u009F]|\s/u;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/u;
const MALFORMED_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const ENCODED_CONTROL = /%(?:[01][0-9A-Fa-f]|7[Ff])/;

function refuse(code, message) {
	return { ok: false, code: code, message: message };
}

// One decode, and a named outcome for each way it can fail: a `%` not followed by two hex digits
// is `bad_encoding`; well-formed escapes that are not UTF-8 are `not_utf8` (the Big5 case, which
// the query side turns into a raw comparison and the path side refuses).
function decodeOnce(text) {
	if (MALFORMED_ESCAPE.test(text)) return refuse('bad_encoding', 'a % must be followed by two hex digits');
	try {
		return { ok: true, value: decodeURIComponent(text) };
	} catch (e) {
		return refuse('not_utf8', 'percent-encoded bytes are not UTF-8');
	}
}

/**
 * The canonical spelling of a site path, with the reason when there is none.
 * @param {string} path  a site-absolute path, as a rule's `from` (query already split off) or a
 *                       request's `url.pathname`
 * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
 */
export function canonPathDetail(path) {
	if (typeof path !== 'string' || path === '') return refuse('path_not_site_relative', 'path is empty');
	if (!path.startsWith('/')) return refuse('path_not_site_relative', 'path must start with /');
	if (path.startsWith('//')) return refuse('path_not_site_relative', 'a path starting with // is protocol-relative, not a site path');
	if (path.includes('\\')) return refuse('backslash', 'a backslash is not a path separator');
	if (/%2f|%5c/i.test(path)) return refuse('encoded_separator', '%2F and %5C are refused: an encoded separator is not a path segment');
	if (CONTROL_OR_SPACE.test(path)) return refuse('control_char', 'control characters and whitespace are refused in a path');
	if (path.includes('?') || path.includes('#')) return refuse('path_has_query', 'a path cannot carry ? or #');
	let pathname;
	try { pathname = new URL(path, BASE).pathname; } catch (e) { return refuse('bad_encoding', 'not a parseable path'); }
	const decoded = decodeOnce(pathname);
	if (!decoded.ok) return decoded.code === 'not_utf8' ? refuse('bad_encoding', decoded.message) : decoded;
	let value = decoded.value.normalize('NFC');
	if (CONTROL_OR_SPACE.test(value)) return refuse('control_char', 'control characters and whitespace are refused in a path (after decoding)');
	if (value.includes('\\')) return refuse('backslash', 'a backslash is not a path separator (after decoding)');
	if (value.endsWith('/index.html')) value = value.slice(0, -'/index.html'.length) || '/';
	if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
	if (value.length > 1 && (value.includes('//') || value.endsWith('/'))) return refuse('empty_segment', 'a path cannot have an empty segment');
	return { ok: true, value: value };
}

/** canonPathDetail, as a string or null. The worker's spelling. */
export function canonPath(path) {
	const r = canonPathDetail(path);
	return r.ok ? r.value : null;
}

// A pair the decoder could not read as UTF-8, in a form that is still one spelling: `+` is the
// form-encoding of a space, and hex case is the only other freedom a percent-escape has. 🩸 A
// rule's `from` is not yet serialised and a request's `url.search` is: `?name=中%B7%7B` arrives as
// `?name=%E4%B8%AD%B7%7B`, and comparing them raw baked a key no request could reach (tile#158 r3).
// So the raw form is the URL serialiser's own output: what it escapes in a special-scheme query —
// non-ASCII as UTF-8 `%XX` (a lone surrogate as U+FFFD's bytes, as the parser does), and `"` `'`
// `<` `>` — is escaped, uppercase; existing `%XX` legacy bytes are kept as written. On a request
// this is a no-op (the serialiser already did it); on a rule it is the serialiser, run early. One
// `from` can never be raw on one side and decodable on the other: the literal characters
// contribute whole UTF-8 sequences, so the escaped bytes are valid UTF-8 together exactly when
// they are valid between the literals — no `mixed_encoding` refusal is needed.
const UTF8 = new TextEncoder();
const SERIALISER_ESCAPES = /[^\u0000-\u007F]+|["'<>]/gu;
function percentEncodeBytes(run) {
	let out = '';
	for (const b of UTF8.encode(run)) out += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
	return out;
}
function rawPair(text) {
	return text.replace(SERIALISER_ESCAPES, percentEncodeBytes)
		.replace(/\+/g, '%20').replace(/%[0-9a-fA-F]{2}/g, (m) => m.toUpperCase());
}

function serialisePair(name, value) {
	return new URLSearchParams([[name, value]]).toString();
}

/**
 * The canonical spelling of a query string, with the reason when there is none.
 * @param {string} search  `?a=1&b=2`, with or without the leading `?`
 * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
 *   `value` is '' for an empty query — the compiler refuses that (it is a path rule), the worker
 *   never asks (it only looks a query up when the request has one).
 */
export function canonQueryDetail(search) {
	if (typeof search !== 'string') return refuse('bad_encoding', 'query is not a string');
	let text = search.startsWith('?') ? search.slice(1) : search;
	if (text.includes('#')) return refuse('fragment', 'a fragment is never sent to the server, so a rule cannot match one');
	if (CONTROL.test(text)) return refuse('control_char', 'control characters are refused in a query');
	const pairs = [];
	for (const piece of text.split('&')) {
		if (piece === '') continue;
		if (pairs.length === QUERY_REDIRECTS_MAX_PAIRS) return refuse('too_many_pairs', 'more than ' + QUERY_REDIRECTS_MAX_PAIRS + ' parameters');
		const eq = piece.indexOf('=');
		const rawName = eq === -1 ? piece : piece.slice(0, eq);
		const rawValue = eq === -1 ? '' : piece.slice(eq + 1);
		const name = decodeOnce(rawName.replace(/\+/g, ' '));
		const value = decodeOnce(rawValue.replace(/\+/g, ' '));
		if (name.code === 'bad_encoding' || value.code === 'bad_encoding') return refuse('bad_encoding', 'a % must be followed by two hex digits');
		if (!name.ok || !value.ok) {
			// 🔴 Legacy bytes: compared raw, as one atomic pair, so the request `?name=%b7%7b` and
			// the rule `?name=%B7%7B` are the same key and neither becomes U+FFFD. 🩸 The decoder
			// gave up on the whole pair, so its control check never ran: `%B7%7B%00` compiled
			// (tile#158 r2). Ask the escapes directly — C0 and DEL only; 0x80–0x9F are Big5 trail
			// bytes here, not C1 controls.
			if (ENCODED_CONTROL.test(rawName) || ENCODED_CONTROL.test(rawValue)) {
				return refuse('control_char', 'control characters are refused in a query (after decoding)');
			}
			pairs.push({ name: rawPair(rawName), value: rawPair(rawValue), raw: true });
			continue;
		}
		const n = name.value.normalize('NFC');
		const v = value.value.normalize('NFC');
		if (CONTROL.test(n) || CONTROL.test(v)) return refuse('control_char', 'control characters are refused in a query (after decoding)');
		pairs.push({ name: n, value: v, raw: false });
	}
	const serialised = pairs.map((p) => p.raw
		? { name: p.name, value: p.value }
		: (() => { const s = serialisePair(p.name, p.value); const i = s.indexOf('='); return { name: s.slice(0, i), value: s.slice(i + 1) }; })());
	serialised.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
	return { ok: true, value: serialised.map((p) => p.name + '=' + p.value).join('&') };
}

/** canonQueryDetail, as a string or null. The worker's spelling. */
export function canonQuery(search) {
	const r = canonQueryDetail(search);
	return r.ok ? r.value : null;
}

// The site-relative gate a `to` must pass — the same one the platform's redirect readers apply to
// a path rule's target: starts with `/`, not `//`, no scheme anywhere, no `_redirects` placeholder
// syntax, no control characters, no backslash. The target is a Location header, not a key, so it is
// not canonicalised — but it IS made header-safe: 🩸 a raw `/產品` passed every check below and
// then made `new Response(…, {headers: {location}})` throw a ByteString TypeError on every request
// that matched it (tile#158 r2). Non-ASCII characters are percent-encoded as UTF-8; everything
// already ASCII — existing `%XX` escapes, reserved characters — is kept exactly as written.
export function targetDetail(to) {
	if (typeof to !== 'string' || to === '') return refuse('to_not_site_relative', 'target is empty');
	if (!to.startsWith('/') || to.startsWith('//')) return refuse('to_not_site_relative', 'target must be a site-relative path starting with a single /');
	if (to.includes('://')) return refuse('to_not_site_relative', 'target cannot name a scheme');
	if (to.includes('\\')) return refuse('to_not_site_relative', 'target cannot contain a backslash');
	if (CONTROL_OR_SPACE.test(to)) return refuse('to_not_site_relative', 'target cannot contain control characters or whitespace');
	if (/\*|\/:[A-Za-z]/.test(to)) return refuse('to_not_site_relative', 'target cannot use _redirects placeholders (* or :name)');
	if (MALFORMED_ESCAPE.test(to)) return refuse('bad_encoding', 'target has a % not followed by two hex digits');
	// Decoded once only to LOOK: an escaped control character is still a control character, and a
	// target on this (UTF-8) site has no business carrying bytes that are not UTF-8.
	const decoded = decodeOnce(to);
	if (!decoded.ok) return refuse('bad_encoding', 'target: ' + decoded.message);
	if (CONTROL.test(decoded.value)) return refuse('to_not_site_relative', 'target cannot contain control characters (after decoding)');
	let location;
	try { location = to.replace(/[^\u0000-\u007F]+/gu, (run) => encodeURIComponent(run)); } catch (e) {
		return refuse('bad_encoding', 'target has a character with no UTF-8 spelling (a lone surrogate)');
	}
	// The gate that matters to the worker, asked directly: what is baked must be a header value.
	if (!/^[!-~]+$/.test(location)) return refuse('to_not_header_safe', 'target cannot be sent as a Location header');
	return { ok: true, value: location };
}

/**
 * Parse the three-column grammar. Lines are `from to 301` separated by runs of whitespace; `from`
 * may carry `?k=v`; a line whose first non-blank character is `#` is a comment; blank lines are
 * skipped. Nothing is canonicalised here — this is the reader, compile() is the judge.
 * @param {string} text
 * @returns {{line: number, from: string, to: string, status: string}[]}
 */
export function parseQueryRedirects(text) {
	if (typeof text !== 'string') throw new QueryRedirectError('bad_line', 'file is not text');
	const out = [];
	const lines = text.replace(/^﻿/, '').split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '' || line.startsWith('#')) continue;
		const cols = line.split(/\s+/);
		if (cols.length !== 3) {
			throw new QueryRedirectError('bad_line', 'expected exactly three columns (from to 301), got ' + cols.length, i + 1);
		}
		out.push({ line: i + 1, from: cols[0], to: cols[1], status: cols[2] });
	}
	return out;
}

// A reserved path or prefix in the spelling compile() compares `from` in. 🩸 The emitter's
// storefront path is URL-serialised (`/%E5%95%86%E5%BA%97`) while canonPath decodes (`/商店`), so a
// non-ASCII storefront compared unequal and a rule took the page away (tile#158 r3). Every list goes
// through canonPath here, once, so no caller has to remember to. A prefix keeps its own trailing
// `/` (that is its meaning, see startsWithPrefix); an entry canonPath refuses is compared as given.
function canonReserved(path) {
	const c = typeof path === 'string' ? canonPath(path) : null;
	return c === null ? path : c;
}
function canonReservedPrefix(prefix) {
	if (typeof prefix !== 'string' || prefix.length < 2 || !prefix.endsWith('/')) return canonReserved(prefix);
	const c = canonReserved(prefix.slice(0, -1));
	return c === '/' ? c : c + '/';
}

// The URLs a request for this rule's key arrives as, for asking a caller's `claimedBy`: the `from`
// as written and the canonical key, each in the serialised spelling `new URL` gives a browser's
// request, and the key with its trailing `/` (canonPath folds `/a/` onto `/a`, so the rule fires
// for both). The pathname is SET rather than parsed, so a `?` or `#` decoded into the key is
// escaped back instead of being read as a delimiter.
function requestSpellings(rawPath, key, search) {
	const out = new Set();
	for (const p of [rawPath, key, key === '/' ? null : key + '/']) {
		if (p === null) continue;
		try {
			const u = new URL('https://site.invalid/');
			u.pathname = p;
			u.search = search;
			out.add(u.href);
		} catch (e) { /* a spelling no URL holds is not a request anyone sends */ }
	}
	return [...out];
}

function startsWithPrefix(path, prefix) {
	// `/shop` is reserved as `/shop` and as `/shop/…`; a prefix given with its own trailing `/` is
	// reserved as that directory and everything under it.
	if (prefix.endsWith('/')) return path === prefix.slice(0, -1) || path.startsWith(prefix);
	return path === prefix || path.startsWith(prefix + '/');
}

/**
 * Compile the file into the shape the worker bakes: `{ v: 1, byPath: { canonPath: { canonQuery: to } } }`.
 * Keys are sorted at both levels, so the same set of rules is the same bytes whatever order the
 * file lists them in.
 *
 * @param {string} text  the contents of `_query-redirects.md`
 * @param {object} [opts]
 * @param {string[]} [opts.reservedPaths]     exact paths the worker answers itself (a site's buyer
 *                                            pages) — refused as a `from`. Any spelling (raw or
 *                                            percent-encoded); canonicalised here before comparing.
 * @param {string[]} [opts.reservedPrefixes]  prefixes the worker answers itself (storefronts) —
 *                                            refused as a `from`, at and under them. Any spelling,
 *                                            canonicalised here. Always includes
 *                                            QUERY_REDIRECTS_RESERVED_PREFIXES.
 * @param {(href: string) => (string|null)} [opts.claimedBy]  asks the WORKER's own matchers whether
 *                                            it answers a request for `href` itself; a truthy answer
 *                                            (the route's name) refuses the rule. Called with every
 *                                            spelling of the rule's key (requestSpellings). The
 *                                            emitter passes this instead of lists: a list re-derived
 *                                            beside the matchers drifts from them (tile#158 r4).
 * @throws {QueryRedirectError} with a `code` naming the refusal, and the `line` it is about
 */
export function compile(text, opts = {}) {
	const rules = parseQueryRedirects(text);
	if (rules.length > QUERY_REDIRECTS_MAX_RULES) {
		throw new QueryRedirectError('too_many_rules', rules.length + ' rules; the cap is ' + QUERY_REDIRECTS_MAX_RULES);
	}
	const reservedPaths = new Set((opts.reservedPaths || []).map(canonReserved));
	const reservedPrefixes = [...QUERY_REDIRECTS_RESERVED_PREFIXES, ...(opts.reservedPrefixes || [])].map(canonReservedPrefix);
	const byPath = {};
	const keys = [];   // [canonPath, canonQuery, to, line] in file order, for the chain guard
	for (const rule of rules) {
		const where = rule.line;
		if (rule.from.length > QUERY_REDIRECTS_MAX_CHARS || rule.to.length > QUERY_REDIRECTS_MAX_CHARS) {
			throw new QueryRedirectError('rule_too_long', 'from and to are each capped at ' + QUERY_REDIRECTS_MAX_CHARS + ' characters', where);
		}
		if (rule.status !== QUERY_REDIRECTS_STATUS) {
			throw new QueryRedirectError('unsupported_status', 'only ' + QUERY_REDIRECTS_STATUS + ' is compiled here, got ' + rule.status, where);
		}
		if (rule.from.includes('#')) throw new QueryRedirectError('fragment', 'a fragment is never sent to the server, so a rule cannot match one', where);
		const q = rule.from.indexOf('?');
		if (q === -1) throw new QueryRedirectError('empty_query', 'from carries no query string — that is a path rule, and belongs in _redirects', where);
		const path = canonPathDetail(rule.from.slice(0, q));
		if (!path.ok) throw new QueryRedirectError(path.code, 'from: ' + path.message, where);
		const query = canonQueryDetail(rule.from.slice(q));
		if (!query.ok) throw new QueryRedirectError(query.code, 'from: ' + query.message, where);
		if (query.value === '') throw new QueryRedirectError('empty_query', 'from carries an empty query string — that is a path rule, and belongs in _redirects', where);
		const to = targetDetail(rule.to);
		if (!to.ok) throw new QueryRedirectError(to.code, 'to: ' + to.message, where);
		if (reservedPaths.has(path.value) || reservedPrefixes.some((prefix) => startsWithPrefix(path.value, prefix))) {
			throw new QueryRedirectError('reserved_path', 'from: ' + path.value + ' is answered by the worker itself; a rule there could never match', where);
		}
		if (typeof opts.claimedBy === 'function') {
			for (const href of requestSpellings(rule.from.slice(0, q), path.value, rule.from.slice(q))) {
				const owner = opts.claimedBy(href);
				if (owner) throw new QueryRedirectError('reserved_path', 'from: ' + path.value + ' is answered by the worker itself (' + owner + '); a rule there could never match', where);
			}
		}
		const perPath = byPath[path.value] || (byPath[path.value] = {});
		if (Object.prototype.hasOwnProperty.call(perPath, query.value)) {
			const code = perPath[query.value] === to.value ? 'duplicate_rule' : 'conflicting_rule';
			throw new QueryRedirectError(code, 'from ' + path.value + '?' + query.value + ' is already mapped to ' + perPath[query.value], where);
		}
		perPath[query.value] = to.value;
		keys.push({ path: path.value, query: query.value, to: to.value, line: where });
	}
	// Chain guard: a target that is itself a source would answer the hop with a second 301.
	for (const k of keys) {
		const hash = k.to.indexOf('#');
		const target = hash === -1 ? k.to : k.to.slice(0, hash);
		const tq = target.indexOf('?');
		const tPath = canonPath(tq === -1 ? target : target.slice(0, tq));
		const tQuery = tq === -1 ? '' : canonQuery(target.slice(tq));
		if (tPath !== null && tQuery && byPath[tPath] && Object.prototype.hasOwnProperty.call(byPath[tPath], tQuery)) {
			throw new QueryRedirectError('chain', 'to: ' + k.to + ' is itself a query-redirect source; a 301 must land, not hop', k.line);
		}
	}
	const sorted = {};
	for (const p of Object.keys(byPath).sort()) {
		const per = {};
		for (const qk of Object.keys(byPath[p]).sort()) per[qk] = byPath[p][qk];
		sorted[p] = per;
	}
	const map = { v: QUERY_REDIRECTS_VERSION, byPath: sorted };
	const bytes = new TextEncoder().encode(JSON.stringify(map)).length;
	if (bytes > QUERY_REDIRECTS_MAX_BYTES) {
		throw new QueryRedirectError('map_too_large', 'the compiled map is ' + bytes + ' bytes; the cap is ' + QUERY_REDIRECTS_MAX_BYTES);
	}
	return map;
}

/** How many rules a compiled map holds. */
export function countRules(map) {
	let n = 0;
	for (const p of Object.keys((map && map.byPath) || {})) n += Object.keys(map.byPath[p]).length;
	return n;
}

/**
 * The worker's lookup. Zero work for a request without a query, one object index for a request
 * whose path is not in the map, a length check against MAX_SEARCH, and the query
 * canonicalisation only when the search is short enough to be the browser spelling of a source.
 * @param {string} pathname  `url.pathname`
 * @param {string} search    `url.search`
 * @param {object} byPath    the compiled map's `byPath`
 * @returns {string|null}    the `to` of an exact hit, else null
 */
export function lookupQueryRedirect(pathname, search, byPath) {
	if (!byPath || !search || search === '?') return null;
	const p = canonPath(pathname);
	if (p === null || !Object.prototype.hasOwnProperty.call(byPath, p)) return null;
	const perPath = byPath[p];
	if (search.length > QUERY_REDIRECTS_MAX_SEARCH) return null;
	const q = canonQuery(search);
	if (q === null || q === '') return null;
	return Object.prototype.hasOwnProperty.call(perPath, q) ? perPath[q] : null;
}
