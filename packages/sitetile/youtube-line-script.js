// The inline script a YouTube line ships — ONE copy, read by both renderers (tile#148).
//
// A paragraph that is only a YouTube link renders as a link wrapped round our own poster
// (site-core.js `youtubeLineHtml`). Without this script that link is the whole feature: it opens the
// video on YouTube, which is what the author's line did before. With it, pressing the poster swaps
// the link for the player — youtube-nocookie, autoplaying because the visitor just asked for it —
// and not one byte or cookie from Google reaches the page before that press (the same rule, and
// the same swap, as cardtile's `video` cell: card-render.mjs VIDEO_JS).
//
// bodyHtml writes it after every YouTube line, so a post's body carries what it needs wherever that
// body is rendered (a built page, an editor's string preview). It is idempotent: the first copy on a
// page installs one delegated listener and every later copy returns at once. A click with a modifier
// (open in a new tab, …) or another button is left to the browser — it is a link, and stays one.
//
// smoke-build.mjs admits it to the accounted client-JS set by the string `a.st-video-yt[data-yt]`.
export const YOUTUBE_LINE_SCRIPT = "(function(){if(window.__stYt)return;window.__stYt=1;"
  + "document.addEventListener('click',function(e){"
  + "var a=e.target&&e.target.closest&&e.target.closest('a.st-video-yt[data-yt]');"
  + "if(!a||e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;"
  + "var id=a.getAttribute('data-yt')||'';if(!/^[\\w-]{11}$/.test(id))return;"
  + "var s=a.getAttribute('data-yt-start')||'';"
  + "e.preventDefault();var f=document.createElement('iframe');"
  + "f.src='https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1'+(/^[1-9]\\d*$/.test(s)?'&start='+s:'');"
  + "f.title='YouTube '+id;"
  + "f.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';"
  + "f.allowFullscreen=true;f.referrerPolicy='strict-origin-when-cross-origin';"
  + "a.replaceWith(f);f.focus();});})();";
