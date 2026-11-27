// Fixture for scripts/runtime-scan.mjs, rule cookie-write. Each line that ends in `expect <rule>`
// (optionally `xN`) must produce exactly that many findings of that rule ON THAT LINE, and every
// other line none. The scan never runs this file; it only reads it.
document.cookie = "a=1; path=/"; // expect cookie-write
document.cookie += "b=2"; // expect cookie-write
document.cookie ||= "c=3"; // expect cookie-write
document['cookie'] = 'd=4'; // expect cookie-write
document [ "cookie" ] = `e=5`; // expect cookie-write
window.document.cookie = "f=6"; // expect cookie-write
var d = document; d.cookie = "g=7"; // expect cookie-write
document
  .cookie // expect cookie-write
  = "h=8";
document.cookie="i=9",document["cookie"]="j=10";self.document.cookie=x+"k" // expect cookie-write x3
console.log(document.cookie, document["cookie"] === "x", document.cookie == "y");
for (document.cookie of values); // expect cookie-write
