import { fetchFunctionRecord, fetchBlob, parseAtUri } from "../lib/atproto.js";
import { executePure } from "./executePure.js";
import { executeHost } from "./executeHost.js";
import { executeComponent } from "./executeComponent.js";
import type { WorkflowRecord, WorkflowStepResult } from "../lib/types.js";

// ── Template resolver ─────────────────────────────────────────────────────────
// Resolves {{$.input.x}} and {{$.stepId.x.y}} references in workflow step inputs.
// Supports:
//   {{$.input.foo}}          – value from the original workflow input
//   {{$.stepId.foo.bar}}     – nested path from a previous step's output
//   {{$.stepId}}             – the entire output of a step
// A string that is ENTIRELY a template (and nothing else) is replaced by the
// resolved value (preserving type). A string with mixed content is string-interpolated.

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = parseInt(key, 10);
      cur = cur[isNaN(idx) ? (key as never) : idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function resolveTemplate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    // Full-match: entire string is one template → return typed value
    const fullMatch = /^\{\{\$\.([^}]+)\}\}$/.exec(value);
    if (fullMatch) {
      const parts = fullMatch[1]!.split(".");
      const [head, ...rest] = parts;
      return getPath(ctx[head!], rest);
    }
    // Partial: string-interpolate all templates
    return value.replace(/\{\{\$\.([^}]+)\}\}/g, (_, path: string) => {
      const parts = path.split(".");
      const [head, ...rest] = parts;
      const resolved = getPath(ctx[head!], rest);
      return resolved === undefined ? "" : String(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplate(v, ctx));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplate(v, ctx);
    }
    return out;
  }
  return value;
}

// ── WASM blob CID extraction (mirrors run.ts) ─────────────────────────────────
function wasmBlobCidFromCode(code: unknown): string | undefined {
  if (!code || typeof code !== "object") return undefined;
  const c = code as Record<string, unknown>;
  if (typeof c.cid === "string") return c.cid.trim();
  const ref = c.ref;
  if (typeof ref === "string") return ref.trim();
  if (typeof ref === "object" && ref !== null) {
    const r = ref as Record<string, unknown>;
    if (typeof r.$link === "string") return r.$link.trim();
  }
  return undefined;
}

// ── Single step executor ──────────────────────────────────────────────────────
async function runStep(
  functionUri: string,
  resolvedInput: unknown,
): Promise<unknown> {
  const { record, } = await fetchFunctionRecord(functionUri);
  const { repo } = parseAtUri(functionUri);
  const blobCid = wasmBlobCidFromCode(record.code);

  if (!blobCid) throw new Error(`Step function ${functionUri} has no WASM blob CID`);

  const wasmBytes = await fetchBlob(repo, blobCid);
  const maxMs = record.maxDurationMs ?? 5000;

  const output = await Promise.race([
    record.mode === "pure-v1"
      ? executePure(wasmBytes, record, resolvedInput, blobCid)
      : record.mode === "component-v1"
        ? executeComponent(wasmBytes, resolvedInput)
        : executeHost(wasmBytes, record, resolvedInput, blobCid),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Step timed out after ${maxMs}ms`)), maxMs),
    ),
  ]);

  return output;
}

// ── Workflow executor ─────────────────────────────────────────────────────────
export interface WorkflowResult {
  ok: boolean;
  steps: WorkflowStepResult[];
  output?: unknown;   // final step's output
  error?: string;     // set only if a step fails and the workflow is aborted
  durationMs: number;
}

export async function executeWorkflow(
  workflow: WorkflowRecord,
  input: unknown,
): Promise<WorkflowResult> {
  const wallStart = Date.now();
  const stepResults: WorkflowStepResult[] = [];

  // Context available to template resolver: { input, <stepId>: output, ... }
  const ctx: Record<string, unknown> = { input };

  for (const step of workflow.steps) {
    const stepStart = Date.now();

    try {
      // Resolve input templates against accumulated context
      const resolvedInput = resolveTemplate(step.input ?? {}, ctx);

      const output = await runStep(step.function, resolvedInput);

      ctx[step.id] = output;
      stepResults.push({
        id: step.id,
        ok: true,
        output,
        durationMs: Date.now() - stepStart,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      stepResults.push({
        id: step.id,
        ok: false,
        error,
        durationMs: Date.now() - stepStart,
      });
      // Abort on first failure
      return {
        ok: false,
        steps: stepResults,
        error: `Step "${step.id}" failed: ${error}`,
        durationMs: Date.now() - wallStart,
      };
    }
  }

  // Final step's output becomes the workflow output
  const lastStep = stepResults[stepResults.length - 1]!;

  return {
    ok: true,
    steps: stepResults,
    output: lastStep.output,
    durationMs: Date.now() - wallStart,
  };
}
