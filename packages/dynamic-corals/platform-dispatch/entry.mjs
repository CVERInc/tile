// Deployable entry: wrangler `main` for the dispatch Worker. Kept separate from
// index.mjs because `cloudflare:workers` only resolves inside workerd.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleRequest, capabilityFetch } from './index.mjs';

// ctx.exports.Connector({ props }) -> RPC stub handed to the Site Worker.
export class Connector extends WorkerEntrypoint {
	fetch(request) {
		return capabilityFetch(request, this.env, this.ctx.props);
	}
}

export default {
	fetch(request, env, ctx) {
		return handleRequest(request, env, ctx);
	}
};
