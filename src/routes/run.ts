import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { fetchFunctionRecord, fetchBlob, parseAtUri } from "../lib/atproto.js";
import { executePure } from "../wasm/executePure.js";
import { executeHost } from "../wasm/executeHost.js";
import { executeComponent } from "../wasm/executeComponent.js";
import { runRequestSchema, runResponseSchema } from "../lib/schemas.js";
import type { RunRequest, RunResponse } from "../lib/types.js";

const runRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RunRequest; Reply: RunResponse }>(
    "/xrpc/at.functions.run",
    {
      schema: {
        body: runRequestSchema,
        response: { 200: runResponseSchema },
      },
    },
    async (request: FastifyRequest<{ Body: RunRequest }>, reply: FastifyReply) => {
      const { function: functionUri, input } = request.body;
      const start = Date.now();

      let functionCid: string | undefined;

      try {
        // Resolve the function record from AT Proto
        const { record, cid } = await fetchFunctionRecord(functionUri);
        functionCid = cid;

        // Validate mode
        if (
          record.mode !== "pure-v1" &&
          record.mode !== "host-v1" &&
          record.mode !== "component-v1"
        ) {
          return reply.status(400).send({
            ok: false,
            error: `Unsupported execution mode: ${record.mode}`,
          });
        }

        // Extract blob CID — handle both JSON ({ ref: { $link } }) and
        // CID object ({ ref: CID }) forms that the AT Proto SDK may return.
        const ref = (record.code as unknown as Record<string, unknown>)?.ref;
        const blobCid: string | undefined =
          (ref as Record<string, unknown> | undefined)?.$link as string | undefined ??
          (typeof (ref as { toString?: () => string } | undefined)?.toString === "function"
            ? (ref as { toString: () => string }).toString()
            : undefined);

        if (!blobCid || blobCid === "[object Object]") {
          return reply.status(400).send({
            ok: false,
            error: "Function record has no blob CID",
          });
        }

        // Determine the repo DID for blob fetching
        const { repo } = parseAtUri(functionUri);

        // Fetch the WASM blob
        const wasmBytes = await fetchBlob(repo, blobCid);

        // Execute with timeout enforcement
        const maxMs = record.maxDurationMs ?? 100;
        const output = await Promise.race([
          record.mode === "pure-v1"
            ? executePure(wasmBytes, record, input, blobCid)
            : record.mode === "component-v1"
              ? executeComponent(wasmBytes, input)
              : executeHost(wasmBytes, record, input, blobCid),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Execution timed out after ${maxMs}ms`)),
              maxMs
            )
          ),
        ]);

        return reply.status(200).send({
          ok: true,
          output,
          durationMs: Date.now() - start,
          functionCid,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        request.log.warn({ err, functionUri }, "Function execution failed");
        return reply.status(200).send({
          ok: false,
          error,
          durationMs: Date.now() - start,
          functionCid,
        });
      }
    }
  );
};

export default runRoute;
