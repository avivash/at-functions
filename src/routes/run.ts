import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { fetchFunctionRecord, fetchBlob, parseAtUri, fetchWorkflowRecord, isWorkflowUri } from "../lib/atproto.js";
import { executePure } from "../wasm/executePure.js";
import { executeHost } from "../wasm/executeHost.js";
import { executeComponent } from "../wasm/executeComponent.js";
import { executeWorkflow } from "../wasm/executeWorkflow.js";
import { runRequestSchema, runResponseSchema } from "../lib/schemas.js";
import type { RunRequest, RunResponse } from "../lib/types.js";

/** Rough check for a real base32 CID (not README placeholders like `bafk...`). */
function looksLikeAtprotoBlobCid(cid: string): boolean {
  const s = cid.trim();
  if (s.length < 48 || s.includes("..")) return false;
  return /^b[a-z2-7]+$/.test(s);
}

function wasmBlobCidFromRecordCode(code: unknown): string | undefined {
  if (!code || typeof code !== "object") return undefined;
  const c = code as Record<string, unknown>;

  // Legacy blob ref: top-level `cid` string
  if (typeof c.cid === "string") return c.cid.trim();

  const ref = c.ref;
  if (typeof ref === "string") return ref.trim();
  if (typeof ref === "object" && ref !== null) {
    const r = ref as Record<string, unknown>;
    if (typeof r.$link === "string") return r.$link.trim();
    if (typeof (r as { toString?: () => string }).toString === "function") {
      const s = (r as { toString: () => string }).toString().trim();
      if (s && !s.includes("[object ")) return s;
    }
  }
  return undefined;
}

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
        // ── Workflow dispatch ──────────────────────────────────────────────
        if (isWorkflowUri(functionUri)) {
          const { record: workflow, cid } = await fetchWorkflowRecord(functionUri);
          functionCid = cid;

          const maxMs = workflow.maxDurationMs ?? 60_000;
          const result = await Promise.race([
            executeWorkflow(workflow, input),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Workflow timed out after ${maxMs}ms`)), maxMs),
            ),
          ]);

          return reply.status(200).send({
            ok: result.ok,
            output: result.ok ? { steps: result.steps, output: result.output } : undefined,
            error: result.error,
            durationMs: result.durationMs,
            functionCid,
          });
        }

        // ── Function dispatch ──────────────────────────────────────────────
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

        const blobCid = wasmBlobCidFromRecordCode(record.code);

        if (!blobCid) {
          return reply.status(400).send({
            ok: false,
            error: "Function record has no WASM blob CID (expected code.ref.$link or legacy code.cid)",
          });
        }

        if (!looksLikeAtprotoBlobCid(blobCid)) {
          return reply.status(400).send({
            ok: false,
            error:
              'Invalid WASM blob CID on this record (often a README placeholder such as "bafk..."). Re-upload the WASM and putRecord at.functions.metadata again.',
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
