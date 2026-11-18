// Where a place name goes when it is tapped — the best map each PLATFORM actually honours.
// One copy, for every coral that shows a location (events, countdown).
//   Apple (iOS/iPadOS/macOS) → maps.apple.com — Apple never registers geo:, and there is no OS
//                              "default map" setting, so maps.apple.com is the native path.
//   Android                  → geo: — the one platform where geo: is live; it fires the system's
//                              own map chooser / default map app.
//   anything else            → a Google Maps web search, which also works with no JS at all.
// FUTURE-PROOF: the day Apple honours geo:, widen the Android branch and delete the Apple one.

/** The universal fallback: works on desktop, with no JS, and as a web map on any platform. */
export function mapsUrl(location) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location || '');
}

/** 'apple' | 'android' | 'other', from a user-agent string. */
export function mapPlatform(userAgent) {
  const ua = String(userAgent || '');
  if (/Android/.test(ua)) return 'android';
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(ua) ? 'apple' : 'other';
}

/** The href for a place on this platform. */
export function mapHref(location, userAgent) {
  const platform = mapPlatform(userAgent);
  const q = encodeURIComponent(location || '');
  if (platform === 'apple') return 'https://maps.apple.com/?q=' + q;
  if (platform === 'android') return 'geo:0,0?q=' + q;
  return mapsUrl(location);
}
