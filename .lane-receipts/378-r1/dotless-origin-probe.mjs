// Probe: a dotted stand-in request carrying the DOTLESS stand-in Origin. Run from the repository root.
import worker from '../../packages/cardtile/serve/card-worker.mjs';

const store = () => {
  const kv = new Map();
  return { kv, get: async (k) => kv.get(k) ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; }, put: async (k, v) => { kv.set(k, v); } };
};
const md = ['---', 'title: x', '---', '', '## grid', '', '- [ ] %% card: profile w=6 %% x', ''].join('\n');
const STANDINS = 'service=cards-staging.feelreef.com people=staging.reef.cards legacy=card-staging.feelreef.com';
for (const [stage, extra] of [['split', { CARD_CANONICAL_HOST: 'reef.cards' }], ['open', {}]]) {
  for (const s of ['cards-staging.feelreef.com', 'card-staging.feelreef.com']) {
    for (const p of ['', ':8443']) {
      const env = { PREVIEW: 'true', CARDS_SERVICE_HOST: 'cards.feelreef.com', CARDS_HOST_STANDINS: STANDINS, CARDS: store(), ...extra };
      const r = await worker.fetch(new Request(`https://${s}.${p}/try/park`, { method: 'POST', headers: { origin: `https://${s}${p}` }, body: md }), env);
      console.log(stage, `${s}.${p}`, '<- dotless Origin:', r.status);
    }
  }
}
