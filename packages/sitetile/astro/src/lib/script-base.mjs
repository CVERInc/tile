// script-base — the one origin a site may be told to load the renderer's own scripts from.
//
// A host that serves many people's sites under one registrable domain may want a content-security
// policy in which a site's own origin is never a script source. For that the renderer has to be
// able to load its runtime scripts from a separate origin, the "script base", named at build time:
//
//   SCRIPT_BASE=https://<host>/corals      (an environment variable, read the way this package
//                                           reads PLATFORM_ORIGIN, SITE_ID and SITE_URL)
//
// Unset or empty means OFF: the renderer emits what it always has. This module only READS the
// setting. Nothing calls `runtimeSrc` yet, so no page changes whether the setting is on or off;
// `astro.config.mjs` calls `scriptBase()` once so that a bad value stops the build.
//
// ── This is security code ──────────────────────────────────────────────────────────────────────
// The value decides which origin a page's scripts load from, and it is written in two places that
// must agree byte for byte: the `src` of every runtime script, and the policy that allows them.
// So the reader is ONE anchored grammar, not a list of forbidden things, and it accepts only values
// it can use exactly as written. It never trims, lower-cases, decodes or otherwise repairs.
//
// It deliberately does not decide with `new URL()`. That parser is built to make sense of anything a
// person might type: it deletes tabs and newlines, trims spaces, reads `\` as `/`, lower-cases the
// scheme and host, drops a default port, resolves `..`, folds full-width letters into ASCII and
// turns `0x7f.1` into 127.0.0.1. Each of those is a way for the value an operator reviewed to
// differ from the value a page uses (script-base.test.mjs pins the whole table). `new URL()` is
// used once below, AFTER the grammar has accepted, as a second opinion that must agree exactly.
//
// Any value that is neither off nor in the grammar THROWS. There is no fallback to off: a typo
// must fail the build, not ship a site whose scripts a policy then blocks.
//
// ── The grammar, and the decisions in it ───────────────────────────────────────────────────────
//   https://<host>/corals
//   host   = label ("." label)* "." last-label     at most 253 characters, at least two labels
//   label  = [a-z0-9] ([a-z0-9-]{0,61} [a-z0-9])?  and not "--" in its third and fourth place
//   last-label = a label that begins with a letter
//
//   · scheme     exactly lower-case `https://`. Nothing else is a scheme a script may come from.
//   · port       none, not even `:443`. A URL parser drops the default port, so `host:443` and
//                `host` are one origin with two spellings; only one spelling is accepted. A script
//                host on another port is not a deployment this setting exists for.
//   · userinfo, query, fragment   none, not even empty ones.
//   · path       exactly `/corals`: no trailing slash, nothing after it. The registry of runtime
//                files answers under that prefix; `runtimeSrc` adds the rest.
//   · upper case refused, in the host too. Host names compare case-insensitively, which is exactly
//                why two spellings must not both be valid.
//   · trailing dot   refused. `host.` reaches the same server as `host` but is a different origin
//                to a browser and to a policy; accepting it invites a base that matches nothing.
//   · IP literals    refused, all of them. IPv6 needs `[` `]` and `:`, which are not in the
//                alphabet. IPv4 in every spelling a URL parser reads as an address (dotted, one
//                number, hex, octal) has a last label that begins with a digit, and so does not
//                match last-label. A certificate-backed, policy-named script origin is a name.
//   · IDN        refused in both spellings. A Unicode name is not ASCII (and its mapping to ASCII
//                is lossy: case folding, look-alike letters, ignorable characters). Its ASCII
//                spelling, `xn--…`, is refused because this reader would then have to prove the
//                label is valid Punycode — an invalid one is a host no browser can resolve, the
//                silent breakage this reader exists to prevent — and because what a reviewer reads
//                is not the name a person sees. `--` in the third and fourth place covers `xn--`
//                and the other reserved prefixes. A platform chooses its own script host; if one
//                ever needs such a name, widen the grammar on purpose.
//   · single-label hosts (`localhost`, an intranet name)   refused: not a public origin.
//   · everything else — whitespace, control characters, quotes, angle brackets, backslash, `%`,
//                non-ASCII — is simply not in the alphabet.

export const SCRIPT_BASE_ENV = 'SCRIPT_BASE';

/** The registry id the runtime's files are published under: `<base>/site-runtime/<version>/<file>`. */
export const RUNTIME_ID = 'site-runtime';

/** The whole decision. A value is accepted if and only if it matches this, from first byte to last. */
export const SCRIPT_BASE_GRAMMAR = /^https:\/\/(?=[a-z0-9.-]{1,253}\/)(?:(?!..--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?!..--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\/corals$/;

/** One runtime file: a plain name from a fixed alphabet and the one extension. No `/`, no second
 *  dot (so no `..`), no `%`, nothing a URL parser or a file server could read as a path. */
const ENTRY_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.js$/;

/** An exact release, `major.minor.patch` — never a channel (`v0`), a range or a pre-release tag. */
const VERSION_GRAMMAR = /^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})$/;

export class ScriptBaseError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'ScriptBaseError';
    /** A stable word for the reason (`scheme`, `port`, `trailing-slash`, …), for tests and callers. */
    this.reason = reason;
  }
}

/** A refused value as a build log may show it: quoted, plain printable ASCII, bounded in length. */
function shown(raw) {
  if (typeof raw !== 'string') return `a value of type ${raw === null ? 'null' : typeof raw}`;
  let out = '';
  for (const unit of raw.slice(0, 200).split('')) {
    const c = unit.charCodeAt(0);
    if (unit === '"' || unit === '\\') out += '\\' + unit;
    else if (c >= 0x20 && c <= 0x7e) out += unit;
    else out += '\\u' + c.toString(16).padStart(4, '0');
  }
  return `"${out}"${raw.length > 200 ? ` (first 200 of ${raw.length} characters)` : ''}`;
}

// Why a refused value was refused. This runs ONLY after the grammar has said no and only chooses
// the words of the error: no path through it accepts anything. Checks are ordered from the whole
// value inwards, so the first true statement is the one worth reading.
const HOST_GRAMMAR = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function diagnose(raw) {
  if (typeof raw !== 'string') return ['not-a-string', 'it is not a string'];
  if (/[^\x00-\x7f]/.test(raw)) return ['non-ascii', 'it contains a non-ASCII character (internationalised host names are not accepted, in either spelling)'];
  if (/[\x00-\x1f\x7f]/.test(raw)) return ['control-character', 'it contains a control character (a tab, a newline or similar)'];
  if (raw.includes(' ')) return ['whitespace', 'it contains whitespace'];
  if (/["'`<>\\]/.test(raw)) return ['forbidden-character', 'it contains a quote, an angle bracket or a backslash'];
  if (raw.includes('%')) return ['percent-escape', 'it contains a percent sign (percent-escapes are not accepted)'];
  if (!raw.startsWith('https://')) return ['scheme', 'it does not begin with exactly `https://` (lower case; no other scheme)'];
  const rest = raw.slice('https://'.length);
  const cut = rest.search(/[/?#]/);
  const authority = cut < 0 ? rest : rest.slice(0, cut);
  const tail = cut < 0 ? '' : rest.slice(cut);
  if (authority.includes('@')) return ['userinfo', 'it carries userinfo (`user@host`)'];
  if (/[[\]]/.test(authority)) return ['ip-literal', 'its host is an IP address literal; a host name is required'];
  if (authority.includes(':')) return ['port', 'it names a port (none is accepted, not even :443)'];
  if (authority === '') return ['empty-host', 'its host is empty'];
  const q = raw.indexOf('?');
  const h = raw.indexOf('#');
  if (q >= 0 && (h < 0 || q < h)) return ['query', 'it has a query (`?`)'];
  if (h >= 0) return ['fragment', 'it has a fragment (`#`)'];
  if (authority.endsWith('.')) return ['trailing-dot', 'its host ends with a dot'];
  if (/[A-Z]/.test(authority)) return ['upper-case-host', 'its host has an upper-case letter (write it in lower case)'];
  const labels = authority.split('.');
  if (/^[0-9]/.test(labels[labels.length - 1])) {
    return ['ip-literal', 'the last label of its host begins with a digit: an IP address, or a name a URL parser reads as one; a host name is required'];
  }
  if (labels.some((l) => /^.{2}--/.test(l))) {
    return ['idn', 'a label of its host has `--` in its third and fourth place (`xn--` and the other reserved prefixes): internationalised host names are not accepted'];
  }
  if (!HOST_GRAMMAR.test(authority)) {
    return ['host', 'its host is not a plain host name (two or more labels of a-z, 0-9 and inner hyphens, each at most 63 characters, 253 in all)'];
  }
  if (tail === '/corals/') return ['trailing-slash', 'it ends with a trailing slash'];
  if (tail.startsWith('/corals/')) return ['extra-path', 'it has a path beyond `/corals`'];
  if (tail !== '/corals') return ['wrong-prefix', 'its path is not exactly `/corals`'];
  return ['grammar', 'it does not match the accepted form'];
}

/**
 * The validated script base for a raw setting: `''` when the setting is off (`undefined` or the
 * empty string, and nothing else), the value itself when it is exactly `https://<host>/corals`.
 * Throws a `ScriptBaseError` for every other input.
 */
export function parseScriptBase(raw) {
  if (raw === undefined || raw === '') return '';
  if (typeof raw === 'string' && SCRIPT_BASE_GRAMMAR.test(raw)) {
    // The second opinion. The grammar is the decision; if the platform's URL parser would write
    // this value any other way, the grammar is wrong and nothing should be built on it.
    let u = null;
    try { u = new URL(raw); } catch { u = null; }
    const host = raw.slice('https://'.length, -'/corals'.length);
    if (u && u.href === raw && u.origin === `https://${host}` && u.pathname === '/corals') return raw;
    throw new ScriptBaseError('grammar',
      `${SCRIPT_BASE_ENV} is set to ${shown(raw)}, which is refused: a URL parser does not read it back unchanged. `
      + `This is a defect in the reader's grammar, not in the value; the build stops rather than use it.`);
  }
  const [reason, why] = diagnose(raw);
  throw new ScriptBaseError(reason,
    `${SCRIPT_BASE_ENV} is set to ${shown(raw)}, which is refused: ${why}. `
    + `It must be exactly https://<host>/corals (lower case, no port, no trailing slash), or empty/unset to turn it off. `
    + `The build stops here on purpose: a mistyped script base must not be treated as off.`);
}

/**
 * The script base this build was given, or `''` when the setting is off. Throws when it is set to
 * anything that is not exactly `https://<host>/corals`.
 */
export function scriptBase(env = process.env) {
  return parseScriptBase(env[SCRIPT_BASE_ENV]);
}

/**
 * The URL of one runtime file: `<base>/site-runtime/<version>/<entry>`.
 *
 * `entry` is a plain file name (`head.js`) and `version` an exact `major.minor.patch`; both are
 * checked against a fixed grammar, so no argument can produce a URL outside the base. Throws when
 * the setting is off — there is no URL to give, and an empty string in a `src` attribute means the
 * page's own URL. Branch on `scriptBase()` first.
 *
 * The version is an argument because the runtime's release is not part of this package yet; the
 * runtime package will supply its own.
 */
export function runtimeSrc(entry, version, env = process.env) {
  if (typeof entry !== 'string' || !ENTRY_GRAMMAR.test(entry)) {
    throw new ScriptBaseError('entry',
      `runtimeSrc: ${shown(entry)} is not a runtime entry name. It must be one plain file name: `
      + `a letter or digit, then letters, digits, "_" or "-" (65 characters at most), then ".js". (The base comes from ${SCRIPT_BASE_ENV}.)`);
  }
  if (typeof version !== 'string' || !VERSION_GRAMMAR.test(version)) {
    throw new ScriptBaseError('version',
      `runtimeSrc: ${shown(version)} is not an exact runtime version. It must be major.minor.patch in digits, `
      + `never a channel, a range or a pre-release tag. (The base comes from ${SCRIPT_BASE_ENV}.)`);
  }
  const base = scriptBase(env);
  if (!base) {
    throw new ScriptBaseError('off',
      `runtimeSrc: ${SCRIPT_BASE_ENV} is not set, so there is no URL for "${entry}". Check scriptBase() before asking for one.`);
  }
  return `${base}/${RUNTIME_ID}/${version}/${entry}`;
}
