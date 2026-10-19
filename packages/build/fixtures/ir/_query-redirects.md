# query-string redirects — compiled into the site's worker; Cloudflare never reads this file
# (reef#1882). Three columns like _redirects; `from` may carry ?k=v; only 301.
/product.php?cid=12        /products/widget     301
/?p=123                    /blog/hello          301
# Big5 bytes in a legacy query string (林 in Big5 is %B7%7B) — matched raw, hex case-insensitively.
/big5.php?name=%B7%7B      /people/lin          301
