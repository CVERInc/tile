// Fixture for scripts/runtime-scan.mjs, rule script-element (format: see cookie-write.js).
document.createElement("script"); // expect script-element
document.createElement('script'); // expect script-element
document.createElement(`script`); // expect script-element
document.createElement("SCRIPT"); // expect script-element
document.createElement("scr\x69pt"); // expect script-element
document["createElement"]("script"); // expect script-element
document.createElement?.("script"); // expect script-element
doc.createElementNS("http://www.w3.org/2000/svg", "script"); // expect script-element
var s=document.createElement("script");s.async=!0 // expect script-element
a=document.createElement("script"),b=e.ownerDocument.createElement('Script') // expect script-element x2
document.createElement(f ? 'script' : 'div'); // expect script-element
