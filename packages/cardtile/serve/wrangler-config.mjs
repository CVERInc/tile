// Where the REAL wrangler config is, for the two harnesses that clean up a live KV row.
//
// 🩸 It used to sit beside this file as `wrangler.toml`, and it could not stay: it names a
// Cloudflare account and the creators whose own domains point at this Worker. That is a record of
// who our customers are — the same category as their cards, and the same answer. The package ships
// `wrangler.example.toml` (the shape); the real one lives in the private workspace.
//
// 🔴 Resolution ORDER matters, and an explicit override wins even when it does not exist. A path
// somebody set and we quietly ignored, in favour of one that happened to work, is how a script
// deletes a row in an account nobody meant to touch.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** → an absolute path, or null. Null means "not on this machine", never "use the example". */
export function wranglerConfig() {
  if (process.env.CARDTILE_WRANGLER) return process.env.CARDTILE_WRANGLER;
  for (const rel of [
    '../../../lab/deploy/cardtile.wrangler.toml',        // the incubator, package still here
    '../../../../../lab/deploy/cardtile.wrangler.toml',  // after the package graduates into engine/
  ]) {
    const p = join(HERE, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * → the path if it is usable, or a REASON string if it is not. Never null-and-silent.
 *
 * 🔴 An explicit override that does not exist is the loudest case, not the quietest. wranglerConfig()
 * returns it regardless — being silently overruled is worse — so the check that decides whether to
 * START must be the one that notices the file is missing. A harness that writes to the live store
 * and only discovers at cleanup time that it cannot run wrangler leaves a row on production.
 */
export function usableConfig() {
  const p = wranglerConfig();
  if (!p) {
    return { ok: false, why: 'usage: no wrangler config found — set CARDTILE_WRANGLER, or check out the '
      + 'private workspace beside this repo. Nothing was touched.' };
  }
  if (!existsSync(p)) {
    return { ok: false, why: `usage: CARDTILE_WRANGLER points at ${p}, which does not exist. Nothing was touched.` };
  }
  return { ok: true, path: p };
}
