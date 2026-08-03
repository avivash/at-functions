import type { FastifyInstance } from "fastify";
import { buildDiscoveryQuery, mapSearchResults } from "../lib/discovery.js";

// AT Search query node. On the docker-compose stack this is the service DNS
// name (http://query-node:3002); locally, the host-published port.
const ATSEARCH_QUERY_URL = (
  process.env.ATSEARCH_QUERY_URL ?? "http://127.0.0.1:13002"
).replace(/\/$/, "");

interface DiscoverQuery {
  q?: string;
  limit?: string;
}

/**
 * GET /xrpc/at.functions.discover?q=<free text>&limit=<n>
 *
 * Finds published functions across the whole network (any PDS) by querying
 * AT Search with a `type:at.functions.metadata` filter. Omit `q` to list
 * every indexed function.
 */
export default async function discoverRoute(server: FastifyInstance) {
  server.get<{ Querystring: DiscoverQuery }>(
    "/xrpc/at.functions.discover",
    async (request, reply) => {
      const { q, limit } = request.query;
      const max = Math.min(Math.max(parseInt(limit ?? "25", 10) || 25, 1), 100);
      const query = buildDiscoveryQuery(q);

      try {
        const res = await fetch(
          `${ATSEARCH_QUERY_URL}/search?q=${encodeURIComponent(query)}`,
          { signal: AbortSignal.timeout(15_000) }
        );
        if (!res.ok) {
          return reply
            .status(502)
            .send({ ok: false, error: `AT Search returned ${res.status}` });
        }
        const data = (await res.json()) as { results?: unknown };
        const functions = mapSearchResults(data.results, max);
        return { ok: true, query: q?.trim() ?? "", count: functions.length, functions };
      } catch (err) {
        return reply.status(502).send({
          ok: false,
          error: `AT Search unreachable: ${(err as Error).message}`,
        });
      }
    }
  );
}
