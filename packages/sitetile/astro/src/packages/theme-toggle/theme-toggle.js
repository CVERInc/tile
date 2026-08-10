// REEF with Site — light/dark toggle click behaviour. The FOUC-prevention initial
// set lives inline in SiteLayout's <head> (must run before first paint); this module
// only wires the click (progressive enhancement — the button still shows/works
// visually without JS, it just won't flip until this loads, same posture as the
// locale-banner module).
const KEY = 'rf-theme';

function apply(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  try { localStorage.setItem(KEY, mode); } catch (e) {}
}

const btn = document.getElementById('rf-theme-toggle');
if (btn) {
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    apply(current === 'dark' ? 'light' : 'dark');
  });
}
