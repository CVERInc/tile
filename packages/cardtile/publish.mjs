// Publish a WHOLE card — pictures and all — through the write API.
//
// 🩸 WHY THIS EXISTS. `save_card` takes a THIN card and re-attaches the assets **from the store**.
// That is deliberate and it is the right default (an agent doing the obvious thing must not blank a
// live page's images), but it has a corollary that is easy to miss: **the save door cannot create a
// card that has pictures**. Send a fat card to a handle the store has never seen and the assets lane
// is discarded, silently, with a 200.
//
// Measured 2026-07-30, and caught only by the byte count: three demo cards of 116KB / 2,723KB /
// 200KB published as 1,677 / 5,715 / 707 bytes. Every response said `created: true`.
//
// The three steps below already existed — inside `w/serve.mjs`, where the human editor needed them.
// This is that logic extracted rather than written a second time, so a fix lands in one place.
import { parseCard, serializeCard } from './card-core.js';

/**
 * publishCard(api, handle, fatMd, { baseVersion }) → the save response, plus `uploaded`.
 *
 * `api(method, path, body)` is the caller's authenticated transport — a tiny seam so this file needs
 * no opinion about where the bearer lives (the editor's is on a loopback server; a script's is in
 * the Keychain; neither belongs here).
 *
 * Order matters and is asserted by comment because getting it wrong is silent:
 *   1. read the stored card — for its version and its asset manifest;
 *   2. 🔴 CHECK THE LOCK, before anything is written. An upload IS a write, so a stale caller must
 *      be refused before step 3 modifies the card it is not allowed to touch;
 *   3. upload every image the caller has that the store does not;
 *   4. save the THIN card, guarded by the version read AFTER those uploads — an upload changes the
 *      card, so the caller's version is stale by construction the moment step 3 does anything.
 */
export async function publishCard(api, handle, fatMd, { baseVersion } = {}) {
  const model = parseCard(String(fatMd ?? ''));
  const assets = model.assets || {};

  const current = await api('GET', `/_api/card/${encodeURIComponent(handle)}`);
  const exists = current.status === 200;
  if (!exists && current.status !== 404) return current;

  if (exists && baseVersion && current.json.version !== baseVersion) {
    return {
      status: 409,
      json: {
        conflict: true, expected: baseVersion, current: current.json.version,
        why: 'This card changed after you read it. Re-read it, redo your change, and save again.',
      },
    };
  }

  // A card that does not exist yet has to be created before an asset can be attached to it — and it
  // is created THIN, because that is the only shape the save door accepts. The pictures arrive next.
  let have = new Set();
  if (exists) {
    have = new Set((current.json.assets || []).map((a) => a.id));
  } else {
    const seed = await api('PUT', `/_api/card/${encodeURIComponent(handle)}`, {
      markdown: serializeCard({ ...model, assets: {} }),
    });
    if (seed.status !== 200) return seed;
  }

  const uploaded = [];
  for (const [id, a] of Object.entries(assets)) {
    if (have.has(id)) continue;
    const up = await api('PUT', `/_api/card/${encodeURIComponent(handle)}/asset/${encodeURIComponent(id)}`,
      { base64: a.b64, mime: a.mime });
    if (up.status !== 200) return up;
    uploaded.push(id);
  }

  const after = await api('GET', `/_api/card/${encodeURIComponent(handle)}`);
  const res = await api('PUT', `/_api/card/${encodeURIComponent(handle)}`, {
    markdown: serializeCard({ ...model, assets: {} }),
    base_version: after.status === 200 ? after.json.version : undefined,
  });
  if (res.status === 200) res.json.uploaded = uploaded;
  return res;
}

/**
 * 🔴 The check the byte count would have made for us. A publish that lands far lighter than the file
 * it came from has dropped something — and "dropped the pictures" is the only way that happens here.
 * Returns null when the sizes are consistent, or a sentence when they are not.
 */
export function assertNotThinned(fatMd, storedBytes) {
  const thin = serializeCard({ ...parseCard(String(fatMd ?? '')), assets: {} }).length;
  const fat = String(fatMd ?? '').length;
  if (fat <= thin * 1.05) return null;              // the card carries no meaningful assets anyway
  if (storedBytes >= fat * 0.95) return null;
  return `Published ${storedBytes} bytes from a ${fat}-byte card (its text alone is ${thin}). `
    + 'The images did not land — a save alone cannot create a card that has pictures.';
}

/**
 * 🩸 The check that was missing, and it cost a live demo card.
 *
 * `assertNotThinned` catches a publish that LOST its pictures. It cannot catch a card that never had
 * them — one whose import went over budget, kept the remote URLs, and published cleanly at 12,399
 * bytes while the store happily re-attached 20 assets from the previous version that nothing
 * referenced any more. Every status was 200. Nothing rendered wrong (the images still load from the
 * platform's CDN). The card had simply stopped being a card you can leave with.
 *
 * Measured 2026-07-30 on Incrediville: 34 images, 9.3MB embedded, against a 3,000KB budget.
 *
 * 🔴 Returns a sentence, never a throw. A card that hot-links is a real state — sometimes the only
 * possible one — and the decision to publish it anyway belongs to a person. What must not happen is
 * publishing it without anybody being told.
 */
export function assertSelfContained(fatMd) {
  const remote = (String(fatMd ?? '').match(/\b(?:img|avatar|bg|poster|iconimg|images)=["']?https?:/g) || []).length;
  if (!remote) return null;
  return `This card still points at ${remote} REMOTE image(s) — it is not self-contained, so closing the `
    + 'source account blanks it. Either it went over the embed budget (a Site, not a Card) or --embed '
    + 'was never run.';
}
