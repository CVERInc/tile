import { matchShopIndex, parseCoralDiv, injectCoralGrid } from './shop-function-template.js';

let pass = 0, fail = 0;
const ok = (n, c, d='') => { (c?pass++:fail++); console.log((c?'PASS':'FAIL'),'-',n, d&&!c?'| '+d:''); };

const shops = [{ shopPath: '/zh-tw/shop' }, { shopPath: '/shop' }];
ok('idx: /shop', matchShopIndex('/shop', shops)?.shopPath === '/shop');
ok('idx: /shop/', matchShopIndex('/shop/', shops)?.shopPath === '/shop');
ok('idx: /shop/slug → null (detail, not index)', matchShopIndex('/shop/slug', shops) === null);
ok('idx: /zh-tw/shop/', matchShopIndex('/zh-tw/shop/', shops)?.shopPath === '/zh-tw/shop');
ok('idx: /faq → null', matchShopIndex('/faq', shops) === null);

const shell = '<!doctype html><html><head></head><body><main>\n<div data-dynamic-coral="square-shop" data-guild-id="g1" data-cart="1" data-detail-base="/shop" data-add-label="加入"></div>\n<script src="x"></script>\n</main></body></html>';
const c = parseCoralDiv(shell);
ok('coral: cart mode read', c && c.cart === true);
ok('coral: detailBase read', c && c.detailBase === '/shop');
ok('coral: localized add label read', c && c.labels.add === '加入');
ok('coral: none → null', parseCoralDiv('<main>no coral here</main>') === null);
ok('coral: instant (no data-cart) → cart false', parseCoralDiv('<main><div data-dynamic-coral="square-shop" data-guild-id="g"></div></main>').cart === false);

const injected = injectCoralGrid(shell, c.tag, '<div class="dc-square-shop-grid" data-ssr="1">CARDS</div>');
ok('inject: grid is now INSIDE the coral div', /data-dynamic-coral="square-shop"[^>]*><div class="dc-square-shop-grid" data-ssr="1">CARDS<\/div><\/div>/.test(injected));
ok('inject: original empty div gone', !injected.includes('data-detail-base="/shop"></div>'));
ok('inject: rest of shell intact (script still there)', injected.includes('<script src="x">'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
