// REEF with Events — the DYNAMIC edge. A tiny Cloudflare Worker that fetches an iCal calendar at
// request time, parses + renders it with the SAME node-tested core (ical.mjs / events-core.mjs),
// and returns the `{ html }` shape events.js already injects. Edge-cached ~10 min, so a creator's
// Google-Calendar edits appear on-page with ZERO redeploy — the "live-edge variant" of gen-events.
//
// Why an edge worker at all: Google's iCal endpoint sends no CORS headers, so a browser can't fetch
// it cross-origin. This worker is the same-purpose proxy — fetch + parse at the edge, CORS-open the
// small JSON result. The client (events.js) is unchanged except its data-src points here.
//
//   GET /?cal=<google-ical-url>&locale=zh-TW&show=6&add=加入行事曆
import { parseICal } from './ical.mjs';
import { mergeEvents, renderEvents } from './events-core.mjs';

// 🔒 SSRF guard — only fetch PUBLIC Google Calendar iCal feeds. Without this the worker would fetch
// any URL a query param names (internal metadata endpoints, etc.). The cal is a public calendar, so
// no secret is exposed by carrying it in the query string.
const CAL_RE =
	/^https:\/\/calendar\.google\.com\/calendar\/ical\/[A-Za-z0-9%._-]+\/public\/basic\.ics$/;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Accept'
};

function json(obj, status = 200, extra = {}) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra }
	});
}

export default {
	async fetch(request) {
		if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
		if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

		const url = new URL(request.url);
		// Major-versioned path, opened on day one (2026-07-16) BEFORE any breaking change exists:
		// once a URL is pasted into a site's IR it is a permanent contract, so the major goes into
		// the path while it's still free. `/v0/` = the 0.x contract this worker renders today; a
		// future breaking render change ships as `/v1/` alongside it, and old embeds keep working.
		// Bare `/` stays as a legacy alias of the current major — ZERO known consumers today (the one
		// events user moved to /v0/; a fleet audit found no other embeds), kept only so
		// stale cached HTML from pre-versioning deploys keeps rendering. Retire at the 1.0 freeze.
		const major = url.pathname.replace(/\/+$/, '') || '/';
		if (major !== '/' && major !== '/v0') {
			return json({ error: `unknown major ${major}; this worker renders /v0/` }, 404);
		}
		const cal = url.searchParams.get('cal') || '';
		if (!CAL_RE.test(cal)) {
			return json({ error: 'cal must be a public Google Calendar iCal URL' }, 400);
		}
		const locale = url.searchParams.get('locale') || 'en-US';
		const show = Math.max(1, Math.min(20, Math.floor(Number(url.searchParams.get('show')) || 5)));
		// `countdown=always` keeps the badge on for far-off dates (w/mo) instead of only inside 7d.
		// Baked here as well as read client-side from data-countdown: if only the client knew, the
		// first paint would ship a blank badge and it would pop in a second later.
		const countdown = url.searchParams.get('countdown') === 'always' ? 'always' : 'near';
		// Only `add` (the add-to-calendar link) is baked here; countdown / empty labels are applied
		// client-side by events.js via data-* attributes, so they aren't needed at the edge.
		const labels = {};
		const add = url.searchParams.get('add');
		if (add) labels.add = add;

		let icsText;
		try {
			// Let Cloudflare's edge cache the upstream iCal for 10 min too — cheap + kind to Google.
			const r = await fetch(cal, {
				headers: { Accept: 'text/calendar,text/plain' },
				cf: { cacheTtl: 600, cacheEverything: true }
			});
			if (!r.ok) return json({ error: 'calendar_fetch_failed', status: r.status }, 502);
			icsText = await r.text();
		} catch {
			return json({ error: 'calendar_unreachable' }, 502);
		}

		const events = mergeEvents([parseICal(icsText, 'gcal')]);
		const html = renderEvents(events, { showCount: show, now: Date.now(), locale, labels, countdown });
		return json({ html, count: events.length, generatedAt: new Date().toISOString() }, 200, {
			// Edge-cache the rendered result 10 min; serve stale up to 30 min while revalidating.
			'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800'
		});
	}
};
