// pagetile — the lazy door to the flow engine (reef#2279).
//
// A fixed book (comic, PDF, photobook) never pays for reflow: nothing here imports flow-core.js
// statically, and `open(book)` imports it only when the book holds a flow page. The same door takes
// the heavy client libraries later flow sources need (epub.js / a zip reader for #2282), registered
// as more importers — each one is called at most once, on the first flow book, and shared after.
//
//   const loader = createFlowLoader();                 // engine: () => import('./flow-core.js')
//   const libs = await loader.open(book);              // null for a fixed book; { engine, … } otherwise
//
// `importers` is injectable so a host can add libraries and a test can count the calls.

import { hasFlowPages } from './book-core.js';

const DEFAULT_IMPORTERS = { engine: () => import('./flow-core.js') };

function createFlowLoader(importers) {
  const table = Object.assign({}, DEFAULT_IMPORTERS, importers);
  let pending = null;
  return {
    needs: (book) => hasFlowPages(book),
    loaded: () => pending !== null,
    open(book) {
      if (!hasFlowPages(book)) return Promise.resolve(null);
      if (!pending) {
        const names = Object.keys(table);
        pending = Promise.all(names.map((n) => table[n]())).then((mods) => {
          const libs = {};
          names.forEach((n, i) => { libs[n] = mods[i]; });
          return libs;
        });
        // a failed import must not poison the door: the next flow book tries again
        pending.catch(() => { pending = null; });
      }
      return pending;
    },
  };
}

export { createFlowLoader };
