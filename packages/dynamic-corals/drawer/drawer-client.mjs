// REEF — the drawer coral, CLIENT source. Built into drawer.js by dynamic-corals/build.mjs.
//
// WHY A CORAL. A drawer is already coral-shaped: a self-contained overlay that assumes nothing
// about its host, brings its own styles, and owns its whole interaction. Making it one means Card
// needs no namespace of its own — Card becomes sitetile's cells plus a few corals plus a byte
// budget — and it means someone who bought a Site can have drawers too, which is the same argument
// that made the QR popup a coral. It also settles admissibility the right way: a drawer renders its
// own content with no external fetch and costs a couple of KB, so it fits on a Card that must live
// in one store row.
//
// 🔴 THE STYLES ARE NOT IN THIS FILE. They live in drawer-style.mjs and reach the page as a
// <style> the renderer emits. That is not tidiness — it is the whole no-JS promise. The first
// version injected its own stylesheet from script, so with JavaScript off there was no :target
// rule, no panel, nothing: the drawer's "works without JS" was true of the mechanism and false of
// the page. A coral that styles itself from JS can only ever enhance; one whose CSS arrives with
// the document can degrade gracefully.
//
// 🔴 OPENING IS THE BROWSER'S JOB, NOT OURS. A drawer is `:target` — a panel whose id is in the URL.
// That means a plain `<a href="#stockists">` opens it, `<a href="#">` closes it, Back closes it,
// the URL is shareable, and every one of those works with JavaScript switched off or still loading.
// Even the scroll lock is CSS (`body:has(.dc-drawer:target)`).
//
// The first version of this used a hidden checkbox and `:has(:checked)`, and its no-JS test passed
// by setting `checked` in script — which is exactly the thing a reader without JS cannot do. The
// test was measuring the mechanism instead of the promise. `:target` needs no mechanism.
//
// So this file adds only what CSS genuinely cannot: the focus trap, Escape, and returning focus to
// whatever opened the drawer. Those are refinements on content that is already reachable — which
// is the difference between progressive enhancement and a dependency.
//
// WHAT STAYS BEHIND. Parsing `## drawer: <id> | <title>` is cardtile-md's model and stays in
// card-core. The renderer emits panels and triggers; this coral makes them behave. Structure is the
// substrate's, performance is the coral's.

(function () {
  var layers = document.querySelectorAll('[data-dynamic-coral="drawer"]');
  if (!layers.length) return;

  Array.prototype.forEach.call(layers, function (layer) {
    var panels = {};
    Array.prototype.forEach.call(layer.querySelectorAll('[data-drawer-panel]'), function (p) {
      panels[p.getAttribute('data-drawer-panel')] = p;
    });

    var openId = null, opener = null, onKey = null;
    function focusables(el) {
      return el.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    }

    function release() {
      if (onKey) { document.removeEventListener('keydown', onKey, true); onKey = null; }
      if (opener) { try { opener.focus(); } catch (e) {} opener = null; }
      openId = null;
    }

    function trap(id) {
      var panel = panels[id];
      if (!panel || openId === id) return;
      release();
      openId = id;
      var btn = panel.querySelector('.dc-drawer-close');
      if (btn) setTimeout(function () { try { btn.focus(); } catch (e) {} }, 120);
      onKey = function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); history.back(); return; }
        if (ev.key !== 'Tab') return;
        var f = focusables(panel);
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        else if (!panel.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', onKey, true);
    }

    // remember what opened it, so focus can go home afterwards
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-drawer]');
      if (t) opener = t;
    }, true);

    function sync() {
      var id = (location.hash || '').replace(/^#/, '');
      if (id && panels[id]) trap(id);
      else release();
    }
    window.addEventListener('hashchange', sync);
    sync();
  });
})();
