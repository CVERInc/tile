// Deployable entry: wrangler `main` for the dispatch Worker. Kept separate from
// index.mjs because `cloudflare:workers` only resolves inside workerd.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleRequest, capabilityFetch, fetchRoute } from './index.mjs';

// ctx.exports.Connector({ props }) -> RPC stub handed to the Site Worker.
export class Connector extends WorkerEntrypoint {
	fetch(request) {
		return capabilityFetch(request, this.env, this.ctx.props);
	}
}

// Service-binding RPC entry for preview route keys: env.SITE_DISPATCH.fetchRoute(request, { routeKey, host }).
export class RouteDispatch extends WorkerEntrypoint {
	fetchRoute(request, { routeKey, host } = {}) {
		return fetchRoute(request, this.env, this.ctx, { routeKey, host });
	}
}

export default {
	fetch(request, env, ctx) {
		return handleRequest(request, env, ctx);
	}
};
