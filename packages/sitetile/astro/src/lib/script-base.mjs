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
// READ ONCE. The first `scriptBase()` (or `runtimeSrc()`) of a process reads the environment,
// validates it and keeps the outcome — a base, off, or the refusal — for the life of the process.
// Changing `process.env` afterwards changes nothing: one build cannot have the setting off on one
// page and on on the next, or two bases. The config's call is that first read. See "The one read".
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
// THE ERROR NEVER SHOWS THE VALUE. A setting is one paste away from a secret — a token dropped into
// the wrong variable, a URL with credentials in it — and a build log is read by more people than
// the setting is. The error names the setting and the reason, gives the value's length and, where
// one character does not belong, that character's class and position. No character of the value is
// in the message, and the error carries no other property or cause that could hold one.
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

/** How a refused SCRIPT_BASE is described: by its size (or its type), never by its characters. */
function sized(raw) {
  if (typeof raw !== 'string') return `a value of type ${raw === null ? 'null' : typeof raw}`;
  return `a value of ${raw.length} character${raw.length === 1 ? '' : 's'}`;
}

/** Where the first character matching `re` is, counted from 1, as words for a message. */
const position = (raw, re) => `at position ${raw.search(re) + 1}`;

/** An ARGUMENT of runtimeSrc as a build log may show it: quoted, plain printable ASCII, bounded in
 *  length. For names written in code only — never for the setting, which is not shown at all. */
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
// value inwards, so the first true statement is the one worth reading. Every sentence here is
// fixed wording plus, at most, a position: none may quote the value or any part of it.
const HOST_GRAMMAR = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function diagnose(raw) {
  if (typeof raw !== 'string') return ['not-a-string', 'it is not a string'];
  if (/[^\x00-\x7f]/.test(raw)) return ['non-ascii', `it contains a non-ASCII character ${position(raw, /[^\x00-\x7f]/)} (internationalised host names are not accepted, in either spelling)`];
  if (/[\x00-\x1f\x7f]/.test(raw)) return ['control-character', `it contains a control character ${position(raw, /[\x00-\x1f\x7f]/)} (a tab, a newline or similar)`];
  if (raw.includes(' ')) return ['whitespace', `it contains a space ${position(raw, / /)}`];
  if (/["'`<>\\]/.test(raw)) return ['forbidden-character', `it contains a quote, an angle bracket or a backslash ${position(raw, /["'`<>\\]/)}`];
  if (raw.includes('%')) return ['percent-escape', `it contains a percent sign ${position(raw, /%/)} (percent-escapes are not accepted)`];
  if (!raw.startsWith('https://')) return ['scheme', 'it does not begin with exactly `https://` (lower case; no other scheme)'];
  const rest = raw.slice('https://'.length);
  const cut = rest.search(/[/?#]/);
  const authority = cut < 0 ? rest : rest.slice(0, cut);
  const tail = cut < 0 ? '' : rest.slice(cut);
  if (authority.includes('@')) return ['userinfo', 'it carries userinfo (something before an `@` in front of the host; credentials never belong in this setting)'];
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
      `${SCRIPT_BASE_ENV} is set to ${sized(raw)}, which is refused: a URL parser does not read it back unchanged. `
      + `This is a defect in the reader's grammar, not in the value; the build stops rather than use it. (The value itself is not shown.)`);
  }
  const [reason, why] = diagnose(raw);
  throw new ScriptBaseError(reason,
    `${SCRIPT_BASE_ENV} is set to ${sized(raw)}, which is refused: ${why}. `
    + `It must be exactly https://<host>/corals (lower case, no port, no trailing slash), or empty/unset to turn it off. `
    + `The build stops here on purpose: a mistyped script base must not be treated as off. `
    + `(The value itself is not shown, in case it holds a secret.)`);
}

// ── The one read ───────────────────────────────────────────────────────────────────────────────
// An outcome is what one read of an environment came to: `{ value }` (a base, or `''` for off) or
// `{ error }` (the refusal). It is made once and never recomputed.
function readOnce(env) {
  try { return Object.freeze({ value: parseScriptBase(env[SCRIPT_BASE_ENV]) }); } catch (error) { return Object.freeze({ error }); }
}

/** A reader over `outcome()`, which must return the same outcome every time it is called. */
function readerOver(outcome) {
  const base = () => {
    const first = outcome();
    if (first.error) throw first.error;
    // The kept value goes through the grammar again on its way out, every time. It costs nothing,
    // and it means that what this function returns has been validated in this very call.
    return parseScriptBase(first.value);
  };
  return Object.freeze({
    scriptBase() { return base(); },
    runtimeSrc(entry, version) { return srcUnder(base, entry, version); },
  });
}

/**
 * A reader of the setting in `env`: `{ scriptBase(), runtimeSrc(entry, version) }`. Its first use
 * reads `env.SCRIPT_BASE`; every later use gives that same answer (or throws that same error),
 * whatever has happened to `env` since.
 *
 * This is the only way to read a second environment in one process, and it is what the tests use:
 * one reader per case, each over its own object. There is deliberately no way to reset a reader,
 * and none to reset the build's own (below) — a reset that exists is a reset something can call.
 */
export function scriptBaseReader(env) {
  if (env === null || typeof env !== 'object') throw new TypeError('scriptBaseReader: pass the environment object to read');
  let first = null;
  return readerOver(() => (first ??= readOnce(env)));
}

// The build's own reader, over `process.env`. Its outcome is kept on the process, not in this
// module: a bundler may evaluate a second copy of this file (the config loads one, the built pages
// another), and both copies must give the answer the first read gave.
//
// THE SLOT. The outcome is kept on `globalThis` under a registered symbol, as plain data:
//   a frozen `{ value: <base or ''> }`, or a frozen `{ refused: <reason code> }`,
// in a property that is not writable, not configurable and not enumerable. A refusal is kept as
// its reason code only — never as the error object: a second copy of this module has its own
// `ScriptBaseError` class, and an object out of a shared slot is not something to throw onwards.
//
// Any code in the process can name that symbol, so the slot is READ BACK STRICTLY, on every use.
// What is found is taken only if it has exactly the shape written here: an own data property
// sealed as above, holding a frozen plain object with exactly one own key, a data property, that
// is either `value` (a string the grammar accepts, or '') or `refused` (one of this reader's own
// reason codes). Anything else — an object that could still change, a getter, extra keys, an error
// object, a value the grammar refuses — stops the build as tampering, and nothing of it is shown.
//
// What this guarantees, and what it does not. It guarantees ONE ANSWER PER PROCESS, and that the
// answer ALWAYS PASSES THE GRAMMAR. It does not guarantee that the answer came from the
// environment: code that runs before the first read can plant a correctly shaped, valid outcome,
// and that cannot be told from this module's own write. Nothing is lost by that — the same code
// can set `process.env.SCRIPT_BASE` before the first read, which is the setting itself. Whoever
// runs code in the build process before the config loads already chooses the script base.
const PROCESS_SLOT = Symbol.for('sitetile.script-base.first-read');

/** Every reason `parseScriptBase` can refuse a setting for: the only codes a kept refusal may carry. */
const REFUSALS = Object.freeze(['not-a-string', 'non-ascii', 'control-character', 'whitespace', 'forbidden-character',
  'percent-escape', 'scheme', 'userinfo', 'ip-literal', 'port', 'empty-host', 'query', 'fragment', 'trailing-dot',
  'upper-case-host', 'idn', 'host', 'trailing-slash', 'extra-path', 'wrong-prefix', 'grammar']);

const tampered = () => new ScriptBaseError('slot-tampered',
  `${SCRIPT_BASE_ENV}: the outcome kept on this process for the first read has been tampered with: it is not what this reader writes. `
  + `Something else in the build process put it there or changed it. The build stops rather than use it. (Nothing of it is shown.)`);

/** The one own key of a frozen plain object and its value, read through the property's descriptor
 *  so that an accessor is seen as one and never called; `null` when `kept` is anything else.
 *  (Frozen is what makes the answer final: not even a proxy can report a frozen object and later
 *  give another key or value for it.) */
function soleEntry(kept) {
  if (kept === null || typeof kept !== 'object' || Object.getPrototypeOf(kept) !== Object.prototype || !Object.isFrozen(kept)) return null;
  const keys = Reflect.ownKeys(kept);
  if (keys.length !== 1) return null;
  const d = Object.getOwnPropertyDescriptor(kept, keys[0]);
  return d && Object.hasOwn(d, 'value') ? [keys[0], d.value] : null;
}

// The error this copy throws for the kept refusal: the original when this copy made the first
// read, otherwise one made here from the kept reason code. One object per copy, thrown every time.
let refusal = null;

const ofThisProcess = readerOver(() => {
  if (!Object.hasOwn(globalThis, PROCESS_SLOT)) {
    const first = readOnce(process.env);
    let kept = null;
    if (first.error) {
      refusal = first.error;
      kept = { refused: first.error instanceof ScriptBaseError && REFUSALS.includes(first.error.reason) ? first.error.reason : 'grammar' };
    } else {
      kept = { value: first.value };
    }
    Object.defineProperty(globalThis, PROCESS_SLOT, { value: Object.freeze(kept) });
  }
  // Read back the same way whoever wrote it — this call, an earlier one, another copy, or not
  // this module at all.
  const slot = Object.getOwnPropertyDescriptor(globalThis, PROCESS_SLOT);
  if (!slot || !Object.hasOwn(slot, 'value') || slot.writable || slot.configurable || slot.enumerable) throw tampered();
  const [key, kept] = soleEntry(slot.value) ?? [];
  if (key === 'value' && typeof kept === 'string') {
    try { return { value: parseScriptBase(kept) }; } catch { throw tampered(); }
  }
  if (key === 'refused' && typeof kept === 'string' && REFUSALS.includes(kept)) {
    refusal ??= new ScriptBaseError(kept,
      `${SCRIPT_BASE_ENV} was refused when this process first read it (reason: ${kept}), and that refusal stands for the whole process. `
      + `It must be exactly https://<host>/corals (lower case, no port, no trailing slash), or empty/unset to turn it off. `
      + `(The value itself is not shown, in case it holds a secret.)`);
    return { error: refusal };
  }
  throw tampered();
});

/**
 * The script base this build was given, or `''` when the setting is off. Throws when it is set to
 * anything that is not exactly `https://<host>/corals`.
 *
 * Read once per process: the first call decides, and every later call returns the same value (or
 * throws the same error) even if `process.env` has changed. It takes no argument; to read another
 * environment, make a reader with `scriptBaseReader(env)`.
 */
export function scriptBase(...rest) {
  if (rest.length) throw new TypeError('scriptBase() takes no argument: it is the one read of this process. Use scriptBaseReader(env) to read another environment.');
  return ofThisProcess.scriptBase();
}

/**
 * The URL of one runtime file: `<base>/site-runtime/<version>/<entry>`.
 *
 * `entry` is a plain file name (`head.js`) and `version` an exact `major.minor.patch`; both are
 * checked against a fixed grammar, so no argument can produce a URL outside the base. Throws when
 * the setting is off — there is no URL to give, and an empty string in a `src` attribute means the
 * page's own URL. Branch on `scriptBase()` first.
 *
 * The base is the one `scriptBase()` returns: the same read, frozen for the process.
 *
 * The version is an argument because the runtime's release is not part of this package yet; the
 * runtime package will supply its own.
 */
export function runtimeSrc(entry, version, ...rest) {
  if (rest.length) throw new TypeError('runtimeSrc(entry, version) takes no environment: the base is the one read of this process. Use scriptBaseReader(env).runtimeSrc(entry, version) to read another.');
  return ofThisProcess.runtimeSrc(entry, version);
}

/** `runtimeSrc` for a reader: the arguments are checked first, then `base()` is asked. */
function srcUnder(base, entry, version) {
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
  const value = base();
  if (!value) {
    throw new ScriptBaseError('off',
      `runtimeSrc: ${SCRIPT_BASE_ENV} is not set, so there is no URL for "${entry}". Check scriptBase() before asking for one.`);
  }
  return `${value}/${RUNTIME_ID}/${version}/${entry}`;
}
