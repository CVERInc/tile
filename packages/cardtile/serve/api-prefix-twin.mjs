// Test support: run an API test file a second time with every `/_api/card/<handle>…` request sent to
// `/_api/cards/<handle>…` instead. Not a test file itself, and nothing outside the tests imports it.
//
// The card API answers on both prefixes (card-api.mjs `resourceOf`; docs/VOCABULARY.md, "Routes").
// "Both" is only true if every assertion ever written about the old prefix also holds on the new
// one, so the test files that call the API are not copied: card-api-cards-twin.test.mjs sets
// CARD_API_TWIN=cards and imports them, and each wraps its `handleApi` with `twinned` below. With the
// variable unset — every ordinary run — `twinned` returns the function it was given.
//
// A test that asserts on a path the API echoes back writes it through `asCalled`, because the API
// answers with the path it was called on.

export const TWIN = process.env.CARD_API_TWIN === 'cards';

const OLD = '/_api/card/';
const NEW = '/_api/cards/';

/** the path (or URL) a request really goes to in this run: the new prefix in a twin run, else as written */
export const asCalled = (path) => (TWIN ? String(path).replace(OLD, NEW) : path);

/** the same path on the other prefix, in any run (for tests that compare the two directly) */
export const onCards = (path) => String(path).replace(OLD, NEW);

/** `handleApi`, or in a twin run a `handleApi` that moves each old-prefix request to the new prefix */
export const twinned = (handleApi) => (!TWIN ? handleApi : (request, env, url) => {
  const at = new URL(asCalled(url.href));
  if (at.href === url.href) return handleApi(request, env, url);
  const moved = new Request(at, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body, duplex: 'half' } : {}),
  });
  return handleApi(moved, env, at);
});
