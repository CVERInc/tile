// Fixture for scripts/runtime-scan.mjs, rule string-timer (format: see cookie-write.js).
setTimeout("tick()", 10); // expect string-timer
setInterval('tick()', 1e3); // expect string-timer
setTimeout(`tick()`); // expect string-timer
setTimeout(`tick(${n})`, 5); // expect string-timer
setTimeout("tick(" + n + ")", 5); // expect string-timer
window.setTimeout("tick()"); // expect string-timer
self["setInterval"]("tick()", 9); // expect string-timer
setTimeout?.("tick()"); // expect string-timer
setTimeout("a"),setInterval("b",1),globalThis.setTimeout('c') // expect string-timer x3
setTimeout(("tick()"), 1); // expect string-timer
setInterval((("tick(" + n + ")")), 1); // expect string-timer
(0, setTimeout)('a()', 0); // expect string-timer
setTimeout(f ? 'a()' : 'b()', 0); // expect string-timer
