// node --import ./.lane-receipts/291-r2/as-variant.mjs packages/sitetile/post-body-marks.test.mjs
// with VARIANT=<path to a site-core.js>: the real module URL of packages/sitetile/site-core.js serves
// that file's source instead, so its relative imports resolve exactly as the real one's do.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const core = new URL('../../packages/sitetile/site-core.js', import.meta.url).href;
registerHooks({ load(url, ctx, next) {
  if (url === core) return { format: 'module', source: readFileSync(process.env.VARIANT, 'utf8'), shortCircuit: true };
  return next(url, ctx);
}});
