// The "Every number" sample: one Cards file, one tile per number from 0 to 834,150, exactly
// 26,214,400 bytes (25 MiB, CARD_MAX_BYTES). About 1 in 200 tiles opens a back with a story of its
// own; every prime that has no story opens the one shared `## back: prime`.
//
// It reproduces the prototype's file byte for byte (sha256 below), so every number in README.md is
// measured on the specimen itself and not on a look-alike. Run:
//
//   node sample.mjs <out-path>          writes the file, prints bytes / lines / sha256
//
// The file is written in pieces; nothing here holds the whole 25 MiB string.
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const LAST = 834150;
export const SAMPLE_SHA256 = 'f169698c48e681d2cf563c17746c7dde2ca61af57ef04f7ddca4e28e78e95453';
export const SAMPLE_BYTES = 26214400;

const fmt = (n) => n.toLocaleString('en-US');
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n) => String(n).replace(/\d/g, (d) => SUP[d]);

// ── the classes, in the order a tile's own title is chosen from (first match wins) ───────────────

const sieve = (n) => {
  const comp = new Uint8Array(n + 1);
  comp[0] = comp[1] = 1;
  for (let i = 2; i * i <= n; i++) if (!comp[i]) for (let j = i * i; j <= n; j += i) comp[j] = 1;
  return comp;
};

function classes(last) {
  const fib = [0, 1];
  while (fib[fib.length - 1] + fib[fib.length - 2] <= last) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);
  const fibDetail = new Map();
  for (let k = fib.length - 1; k >= 2; k--) fibDetail.set(fib[k], `${fmt(fib[k - 2])} + ${fmt(fib[k - 1])}`);

  // 1 (= 0! = 1!), then 2!, 3!, … up to `last`
  const facts = new Map([[1, '0! = 1! = 1']]);
  for (let k = 2, f = 2; f <= last; k++, f *= k) facts.set(f, `${k}! = ${Array.from({ length: k }, (_, i) => k - i).join(' × ')}`);

  const perfect = new Map([
    [6, '6 = 1 + 2 + 3'],
    [28, '28 = 1 + 2 + 4 + 7 + 14'],
    [496, '496 = 1 + 2 + 4 + 8 + 16 + 31 + 62 + 124 + 248'],
    [8128, '8,128 = 1 + 2 + 4 + … + 4,064, every divisor but itself'],
  ]);

  const digits = (n) => String(n);
  const repdigit = (n) => n >= 10 && /^(\d)\1+$/.test(digits(n));
  const palindrome = (n) => n >= 10 && digits(n) === [...digits(n)].reverse().join('');
  const runDir = (n) => {
    const s = digits(n);
    if (s.length < 3) return 0;
    const step = s.charCodeAt(1) - s.charCodeAt(0);
    if (step !== 1 && step !== -1) return 0;
    for (let i = 2; i < s.length; i++) if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return 0;
    return step;
  };
  const iroot = (n, k) => { let r = Math.round(n ** (1 / k)); while (r ** k > n) r--; while ((r + 1) ** k <= n) r++; return r; };
  const triRoot = (n) => { const k = Math.round((Math.sqrt(8 * n + 1) - 1) / 2); return k * (k + 1) / 2 === n ? k : -1; };

  return [
    { key: 'perfect', also: 'a perfect number', title: () => 'A perfect number.', has: (n) => perfect.has(n), detail: (n) => perfect.get(n) },
    { key: 'factorial', also: 'a factorial', title: () => 'A factorial.', has: (n) => facts.has(n), detail: (n) => facts.get(n) },
    { key: 'pow2', also: 'a power of two', title: () => 'A power of two.', has: (n) => n > 0 && (n & (n - 1)) === 0, detail: (n) => `2${sup(Math.log2(n))}` },
    { key: 'fib', also: 'Fibonacci', title: () => 'Fibonacci.', has: (n) => n === 0 || n === 1 || fibDetail.has(n), detail: (n) => fibDetail.get(n) },
    { key: 'cube', also: 'a cube', title: () => 'A perfect cube.', has: (n) => iroot(n, 3) ** 3 === n, detail: (n) => { const r = iroot(n, 3); return `${r} × ${r} × ${r}`; } },
    { key: 'square', also: 'a square', title: () => 'A perfect square.', has: (n) => iroot(n, 2) ** 2 === n, detail: (n) => { const r = iroot(n, 2); return `${r} × ${r}`; } },
    { key: 'repdigit', also: 'a repdigit', title: () => 'One digit, all the way.', has: repdigit, detail: () => 'Every digit the same.' },
    { key: 'run', also: 'a run', title: (n) => (runDir(n) > 0 ? 'Counting up.' : 'Counting down.'), has: (n) => runDir(n) !== 0, detail: (n) => [...digits(n)].join(' ') },
    { key: 'triangular', also: 'triangular', title: () => 'Triangular.', has: (n) => triRoot(n) >= 0, detail: (n) => `1 + 2 + … + ${fmt(triRoot(n))}` },
    { key: 'palindrome', also: 'a palindrome', title: () => 'A palindrome.', has: palindrome, detail: () => 'Reads the same both ways.' },
  ];
}

// ── the stories written by hand: [title, line]. A hand-written story still lists every class the
//    number is in ("Also …"), except where `alsoNone` says the prototype leaves it out. ──────────────
const HAND = new Map([
  [0, ['Zero.', 'Where every count starts.']],
  [4, ['Unlucky, in places.', 'In Mandarin, Taiwanese, Cantonese, Japanese and Korean, four sounds like death.']],
  [7, ['Lucky seven.', 'The luckiest number in much of the world.']],
  [8, ['Lucky.', 'In Mandarin, bā (eight) sounds like fā, to prosper.']],
  [13, ['Unlucky.', 'Plenty of buildings skip the 13th floor.']],
  [39, ['Thank you.', 'In Japanese, 3 9 reads san-kyū.']],
  [42, ['The answer.', 'To life, the universe and everything (Douglas Adams).']],
  [100, ['A century.', 'A hundred years, or a hundred runs.']],
  [101, ['The first class.', 'At American colleges, 101 is where a subject starts.']],
  [153, ['Narcissistic.', '1³ + 5³ + 3³ = 153']],
  [273, ['Freezing.', '0 °C is 273.15 kelvin.']],
  [284, ['Amicable.', 'Its divisors other than itself add up to 220, and 220’s add up to 284.']],
  [314, ['Pi Day.', 'March 14, written the American way: 3/14.']],
  [360, ['A full turn.', '360 degrees.']],
  [365, ['A year.', 'In days, most of the time.']],
  [373, ['Boiling.', 'Water boils at about 373 kelvin at sea level.']],
  [404, ['Not found.', 'The web’s way of saying it isn’t here. It is, though.']],
  [418, ['I’m a teapot.', 'An April Fools’ status code from 1998 (RFC 2324).']],
  [443, ['HTTPS.', 'The port a secure web page comes through.']],
  [495, ['A Kaprekar constant.', 'Take three digits, not all the same. Sort them high to low, subtract low to high, repeat: you end up here.']],
  [520, ['I love you.', 'In Mandarin, wǔ èr líng sounds like wǒ ài nǐ.']],
  [886, ['Bye-bye.', 'In Taiwan, bā bā liù sounds like bāi bāi liū.']],
  [1024, ['A kibi.', 'Why a kilobyte is often 1,024 bytes.']],
  [1314, ['Forever.', 'In Mandarin, yī sān yī sì sounds like yī shēng yī shì, a whole lifetime.']],
  [1337, ['Leet.', 'Hacker spelling of “elite”.']],
  [1440, ['A day.', 'In minutes.']],
  [1729, ['The taxicab number.', '1³ + 12³ = 9³ + 10³, the smallest number that is the sum of two positive cubes in two different ways (Ramanujan).']],
  [1969, ['The Moon.', 'The year people first walked on it.']],
  [2001, ['A Space Odyssey.', 'Stanley Kubrick’s film.']],
  [2048, ['The game.', 'Slide the tiles until two 1,024s make one.']],
  [3600, ['An hour.', 'In seconds.']],
  [4649, ['Yoroshiku.', 'In Japanese, 4 6 4 9 reads yo-ro-shi-ku: nice to meet you.']],
  [6174, ['Kaprekar’s constant.', 'Take four digits, not all the same. Sort them high to low, subtract low to high, repeat: you end up here.']],
  [9527, ['The servant.', 'In Flirting Scholar (1993), Stephen Chow’s character signs on as servant No. 9527.']],
  [31337, ['Eleet.', 'Leet, but more so.']],
  [57721, ['γ.', 'The Euler–Mascheroni constant, 0.57721…']],
  [65535, ['The biggest unsigned 16-bit number.', 'Every bit set.']],
  [86400, ['A day.', 'In seconds.']],
  [101325, ['One atmosphere.', 'In pascals, by definition.']],
  [141421, ['√2.', 'To six digits: 1.41421…']],
  [142857, ['The cyclic number.', '× 2 = 285714, × 3 = 428571, × 4 = 571428. Same digits, turning.']],
  [161803, ['The golden ratio.', 'To six digits: 1.61803…']],
  [173205, ['√3.', 'To six digits: 1.73205…']],
  [271828, ['e.', 'To six digits: 2.71828…']],
  [299792, ['Light.', 'Kilometres it travels in one second (299,792.458).']],
  [314159, ['π.', 'To six digits: 3.14159…']],
  [355113, ['Almost π.', '355 ÷ 113 = 3.1415929…, right to six decimal places.']],
  [384400, ['The Moon.', 'Kilometres away, on average.']],
  [525600, ['A year.', 'In minutes.']],
  [602214, ['Avogadro’s number.', '6.02214… × 10²³ to a mole.']],
  [662607, ['Planck’s constant.', '6.62607… × 10⁻³⁴ joule-seconds.']],
]);
// Where the prototype's "Also" line is not the rule's: 0 lists nothing, 1 lists two of its classes.
const ALSO_OVERRIDE = new Map([[0, null], [1, 'Also a power of two, Fibonacci.']]);

/** the story lines of number n, or null when it has none of its own */
export function storyOf(n, cls, comp, counts) {
  const inClasses = cls.filter((c) => c.has(n));
  const hand = HAND.get(n);
  if (!hand && !inClasses.length) return null;
  let lines, rest;
  if (hand) { lines = [...hand]; rest = inClasses; } else {
    const [first, ...others] = inClasses;
    lines = [first.title(n), first.detail(n), `One of ${fmt(counts.get(first.key))} in this file.`];
    rest = others;
  }
  const also = [...rest.map((c) => c.also), ...(comp[n] ? [] : ['a prime'])];
  let alsoLine = also.length ? `Also ${also.join(', ')}.` : null;
  if (ALSO_OVERRIDE.has(n)) alsoLine = ALSO_OVERRIDE.get(n);
  if (alsoLine) lines.push(alsoLine);
  return lines;
}

/** yields the file in pieces, in order; the pieces joined are the file */
export function* pieces(last = LAST) {
  const comp = sieve(last); // comp[n] = 1 when n is NOT prime
  const cls = classes(last);
  const counts = new Map(cls.map((c) => [c.key, 0]));
  for (let n = 0; n <= last; n++) for (const c of cls) if (c.has(n)) counts.set(c.key, counts.get(c.key) + 1);
  let primes = 0;
  for (let n = 0; n <= last; n++) if (!comp[n]) primes++;
  const stories = [];
  let buf = '## grid\n';
  for (let n = 0; n <= last; n++) {
    const s = storyOf(n, cls, comp, counts);
    if (s) stories.push([n, s]);
    buf += `\n- [ ] %% card: text${s ? ` back=#n${n}` : !comp[n] ? ' back=#prime' : ''} %% ${n}`;
    if (buf.length > 1 << 20) { yield buf; buf = ''; }
  }
  for (const [n, s] of stories) {
    buf += `\n\n\n## back: n${n}\n\n- [ ] %% card: text %%\n\t${s.join('\n\t')}`;
    if (buf.length > 1 << 20) { yield buf; buf = ''; }
  }
  buf += `\n\n\n## back: prime\n\n- [ ] %% card: text %%\n\tA prime.\n\tNothing divides it but 1 and itself.\n\tOne of ${fmt(primes)} in this file.\n`;
  yield buf;
}

async function main(out) {
  if (!out) { console.error('usage: node sample.mjs <out-path>'); process.exit(2); }
  const t0 = performance.now();
  const hash = createHash('sha256');
  const w = createWriteStream(out);
  let bytes = 0, lines = 0;
  for (const p of pieces()) {
    const b = Buffer.from(p, 'utf8');
    bytes += b.length; hash.update(b);
    for (let i = 0; i < b.length; i++) if (b[i] === 10) lines++;
    if (!w.write(b)) await new Promise((r) => w.once('drain', r));
  }
  await new Promise((r, j) => w.end((e) => (e ? j(e) : r())));
  const sha = hash.digest('hex');
  // (the output path is not printed: this line is committed as a log, and paths are this machine's)
  console.log(JSON.stringify({ bytes, newlines: lines, sha256: sha, matchesPrototype: sha === SAMPLE_SHA256, ms: Math.round(performance.now() - t0) }));
  if (sha !== SAMPLE_SHA256) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
