// Fixture for scripts/runtime-scan.mjs, rule document-domain (format: see cookie-write.js).
document.domain = "example.com"; // expect document-domain
document["domain"] = "example.com"; // expect document-domain
window.document.domain = "example.com"; // expect document-domain
console.log(document.domain); // expect document-domain
document?.domain; // expect document-domain
document.domain="example.com",self.document["domain"]="example.com" // expect document-domain x2
el.ownerDocument.domain = 'x'; // expect document-domain
frame.contentDocument.domain; // expect document-domain
