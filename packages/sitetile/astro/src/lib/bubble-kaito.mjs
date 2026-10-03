// Does the inbox bubble get its ask-the-assistant half (`data-kaito="1"`)?
//
// The answer is whether the site HAS the assistant, and the build host says so in SITE_KAITO:
//
//   '1' ⇒ yes. On, whatever the site config says — `kaito-corpus` only scopes what the assistant
//         answers from (`pages` | `all`), and its absence means `pages` to the indexer, not "off".
//   '0' ⇒ no. Off, even when the config names a scope or lists `kaito` under `packages`: a config
//         line must never open an assistant the site does not have.
//   anything else (unset included) ⇒ nobody said — a self-hosted build, or a build host that does not
//         pass the bit yet. Then the config decides, exactly as it did before the bit existed.
//
// Only the exact tokens count: a value that merely looks like yes is "nobody said", because '0' is an
// action (it removes a working half) and must not be reached by accident.
export function bubbleKaitoOn(meta = {}, env = (typeof process !== 'undefined' ? process.env : {})) {
  const said = env ? env.SITE_KAITO : undefined;
  if (said === '1') return true;
  if (said === '0') return false;
  return meta['kaito-corpus'] != null
    || String(meta.packages || '').split(',').map((v) => v.trim()).includes('kaito');
}
