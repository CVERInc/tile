// Brand marks, served from our own origin.
//
// A card's link and social icons are favicons — the brand's CURRENT mark, which is why they are
// fetched rather than bundled: an icon set has to be re-packaged every time someone rebrands, and it
// covers only the brands somebody thought to include. A creator's obscure regional platform has a
// favicon and is not in anyone's icon set.
//
// 🔴 But the fetch was the visitor's. Every person opening a card announced their IP to
// icons.duckduckgo.com, for marks belonging to the creator's own links. It was the ONE third party a
// Card still contacted — and the same reasoning that made us proxy the YouTube poster applies here
// with less excuse, because nothing about a favicon needs to come from anywhere in particular.
//
// So the Worker fetches it and the card points at us. The cache key is the DOMAIN, so every card in
// the world pointing at instagram.com shares one upstream fetch: the cost does not scale with cards,
// only with distinct brands.
//
// What this does NOT change: the mark still comes from the brand, so it still cannot go stale.

/**
 * 🔴 The one thing standing between this route and an open proxy. The domain arrives from a card's
 * markdown — creator-authored input — and is concatenated into a URL. Same discipline as VIDEO_RE.
 * Deliberately strict: lowercase labels, at least one dot, no userinfo, no port, no path, no scheme.
 */
// 🔴 The final label must be ALPHABETIC, which is what rejects a bare IP. The first version accepted
// `127.0.0.1` and `169.254.169.254` — the cloud metadata address. Harmless as the code stands, because
// the value lands in DDG's PATH and never in the host we connect to; the guard refuses them anyway,
// because "safe as long as a detail somewhere else stays true" is not a property, it is a coincidence
// waiting for someone to change iconUpstream. No real brand's mark lives at an IP either.
export const ICON_DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Where a card points for a brand mark — our origin, never the favicon service's. */
export const iconPath = (domain) => `/_icon/${domain}.ico`;

/** Upstream. Kept here so the renderer and the Worker cannot disagree about where marks come from. */
export const iconUpstream = (domain) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;
