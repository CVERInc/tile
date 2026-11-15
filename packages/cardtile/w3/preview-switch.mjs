// The editor's preview frame: does it need the document again, or only another view of the one it has?
//
// The preview is the live page (renderCardHTML), and on the live page stack, list and wall are one
// set of nodes: going from one to another is a switch in place (w3/deck.js, window.__deckView), not
// a new page. So the editor hands its frame a document only when the DOCUMENT changed. The same
// document in another view is asked of the frame itself — the call a visitor's tap makes.
//
// Pure: `ask` is the only way out, and it is the caller's (the frame's own __deckView).

/**
 * shown: what the frame holds now — { doc, view } — or null when it holds nothing.
 * next:  what it should show — { doc, view }. `doc` is anything that is === when the page would be
 *        the same page (the editor passes one string made of everything the page is rendered from).
 * ask:   (view) => true when the frame now shows that view. It may throw (a frame that is not
 *        ready) or answer anything else (a page with no deck): both mean "hand it the document".
 * → 'keep'   the frame already shows exactly this
 *   'switch' the frame was asked, and it now shows the view
 *   'render' the frame must be handed the document
 */
export function previewStep(shown, next, ask) {
  if (!shown || shown.doc !== next.doc) return 'render';
  if (shown.view === next.view) return 'keep';
  try { return ask(next.view) === true ? 'switch' : 'render'; } catch { return 'render'; }
}
