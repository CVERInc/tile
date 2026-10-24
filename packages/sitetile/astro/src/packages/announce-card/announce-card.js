// REEF with Site — the announcement card's client half (reef#2301). Same split as theme-toggle:
// the before-first-paint part (an expired or dismissed card never shows) is the inline guard right
// after the card in SiteLayout; this module only re-ticks the countdown, takes the card down at its
// deadline on a page that stays open, and wires the ×. Loaded only on a page that drew a card.
import { mountAnnounceCard } from '../../lib/announce.mjs';

document.querySelectorAll('.rf-announce-card').forEach((card) => mountAnnounceCard(card));
