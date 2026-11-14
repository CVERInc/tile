// Every API test, a second time, on the other prefix.  run: node --test card-api-cards-twin.test.mjs
//
// The card API answers on `/_api/cards/<handle>…` exactly as on `/_api/card/<handle>…`. This file
// holds no assertions of its own: it turns the twin switch on (api-prefix-twin.mjs) and imports the
// test files that call the API, so each of their tests runs again with every old-prefix request sent
// to the new prefix. A test added to one of those files is covered here without being listed twice.
//
// The variable is set before the imports, and the imports are dynamic for that reason: a static
// import is hoisted above the assignment.
process.env.CARD_API_TWIN = 'cards';

const { TWIN } = await import('./api-prefix-twin.mjs');
if (!TWIN) throw new Error('the twin switch is off: this run would repeat the old prefix and prove nothing');

await import('./card-api.test.mjs');
await import('./card-vanity.test.mjs');
await import('./card-webrisk.test.mjs');
await import('./card-url-scheme.test.mjs');
await import('./languages-api.test.mjs');
