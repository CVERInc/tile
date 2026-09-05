// REEF with Events — a minimal iCal (RFC 5545) parser. Pure, node-runnable, zero deps.
// Turns an .ics text feed into the normalized Event shape the events coral renders:
//   { title, start, end, location, description, url, allDay, uid, source: 'ical' }
// start/end are ISO 8601 strings (UTC when the source is UTC/zoned, floating kept as-is).
//
// v1 scope (deliberate): single-instance VEVENTs only. RRULE recurrence expansion is NOT done
// yet (conventions are almost always one-off dated events) — a VEVENT carrying RRULE still yields
// its single DTSTART instance, just not the repeats. TZID is best-effort: the wall-clock time is
// kept verbatim (no Olson tz database in a zero-dep parser); UTC ("Z") and date-only are exact.

/** Unfold RFC 5545 line folding: a CRLF followed by a space or tab continues the previous line. */
function unfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** Unescape TEXT values: \n → newline, \, \; \, literal, per RFC 5545 §3.3.11. */
function unescapeText(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1');
}

/** Split a content line into { name, params, value }. `NAME;P=v;Q=w:VALUE`. */
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

/**
 * Parse an iCal date/time value → { iso, allDay }.
 *   20260815             → date-only (all-day)         → iso 2026-08-15, allDay true
 *   20260815T100000Z     → UTC                          → iso 2026-08-15T10:00:00.000Z
 *   20260815T100000      → floating / zoned (TZID)      → iso 2026-08-15T10:00:00 (wall clock kept)
 */
export function parseICalDate(value, params = {}) {
  const v = String(value || '').trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === 'DATE') {
    const m = dateOnly || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dt) return null;
  const [, y, mo, d, h, mi, s, z] = dt;
  const base = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  return { iso: z ? `${base}.000Z` : base, allDay: false };
}

/**
 * Parse an .ics feed into normalized events. `sourceLabel` is stamped as `source` (default 'ical').
 * Malformed VEVENTs are skipped, never thrown — a bad feed yields the events it can, not a crash.
 */
export function parseICal(text, sourceLabel = 'ical') {
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur && cur.start) {
        events.push({
          title: cur.title || '',
          start: cur.start,
          end: cur.end || null,
          location: cur.location || null,
          description: cur.description || null,
          url: cur.url || null,
          allDay: !!cur.allDay,
          uid: cur.uid || null,
          source: sourceLabel,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
      case 'URL': cur.url = p.value.trim(); break;
      case 'UID': cur.uid = p.value.trim(); break;
      case 'DTSTART': { const d = parseICalDate(p.value, p.params); if (d) { cur.start = d.iso; cur.allDay = d.allDay; } break; }
      case 'DTEND': { const d = parseICalDate(p.value, p.params); if (d) cur.end = d.iso; break; }
      default: break;
    }
  }
  return events;
}
