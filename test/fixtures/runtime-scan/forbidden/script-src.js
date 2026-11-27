// Fixture for scripts/runtime-scan.mjs, rule script-src (format: see cookie-write.js). The scan
// cannot tell a script element from an image in minified code, so EVERY src write is reported.
s.src = url; // expect script-src
s.src += "?v=2"; // expect script-src
s["src"] = url; // expect script-src
s.setAttribute("src", url); // expect script-src
s.setAttribute('SRC', url); // expect script-src
s.setAttributeNS(null, "src", url); // expect script-src
document.currentScript.src = url; // expect script-src
a.src=b,c.setAttribute("src",d),e["src"]=f // expect script-src x3
