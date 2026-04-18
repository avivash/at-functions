import { fetchRecord, fetchBlobByCid, listCollection, parseAtUri } from "../lib/atproto.js";
import { packPtrLen, writeToMemory } from "./abi.js";
import type {
  HostReadRecordInput,
  HostReadRecordOutput,
  HostReadBlobInput,
  HostReadBlobOutput,
  HostListCollectionInput,
  HostListCollectionOutput,
} from "../lib/types.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Each host function reads a JSON request from WASM memory and writes
// a JSON response back, returning a packed ptr/len i64.
//
// The response is written into a small scratch buffer owned by the host.
// The WASM module is expected to copy the result before the next host call.

export interface HostContext {
  memory: WebAssembly.Memory;
  // scratchAlloc is called each time a host function needs to return bytes
  // to WASM. We use the WASM module's own alloc export.
  alloc: (len: number) => number;
}

function readInput<T>(memory: WebAssembly.Memory, ptr: number, len: number): T {
  const view = new Uint8Array(memory.buffer, ptr, len);
  const json = TEXT_DECODER.decode(view);
  return JSON.parse(json) as T;
}

function writeOutput(
  ctx: HostContext,
  output: unknown
): bigint {
  const bytes = TEXT_ENCODER.encode(JSON.stringify(output));
  const ptr = ctx.alloc(bytes.byteLength);
  if (ptr === 0) {
    throw new Error("host alloc returned null pointer");
  }
  writeToMemory(ctx.memory, ptr, bytes);
  return packPtrLen(ptr, bytes.byteLength);
}

function errorOutput(ctx: HostContext, error: string): bigint {
  return writeOutput(ctx, { ok: false, error });
}

export function buildHostImports(ctx: HostContext): WebAssembly.Imports {
  return {
    host: {
      host_read_record: (ptr: number, len: number): bigint => {
        try {
          const input = readInput<HostReadRecordInput>(ctx.memory, ptr, len);
          if (!input.atUri) {
            return errorOutput(ctx, "host_read_record: missing atUri");
          }

          // Synchronous bridge: we cannot await inside a WASM import, so we
          // use a trick — run the async work synchronously via a shared
          // SharedArrayBuffer + Atomics pattern. For this POC we use a
          // pre-resolved promise pattern by making the call synchronously.
          //
          // NOTE: In production, use Atomics + Worker threads for true async.
          // Here we throw if called from async context; the executor wraps
          // each host call in a draining microtask queue.
          let result: HostReadRecordOutput;
          let settled = false;

          fetchRecord(input.atUri).then((r) => {
            result = { ok: true, record: r.record, cid: r.cid };
            settled = true;
          }).catch((e: Error) => {
            result = { ok: false, error: String(e.message) };
            settled = true;
          });

          // Spin until settled (POC only — not suitable for production)
          const deadline = Date.now() + 5000;
          while (!settled && Date.now() < deadline) {
            // busy-wait: acceptable only in a POC with small I/O
          }

          if (!settled) {
            return errorOutput(ctx, "host_read_record timed out");
          }

          return writeOutput(ctx, result!);
        } catch (e) {
          return errorOutput(ctx, String(e));
        }
      },

      host_read_blob: (ptr: number, len: number): bigint => {
        try {
          const input = readInput<HostReadBlobInput>(ctx.memory, ptr, len);
          if (!input.cid) {
            return errorOutput(ctx, "host_read_blob: missing cid");
          }

          let result: HostReadBlobOutput;
          let settled = false;

          // We need a repo DID to fetch a blob. For this POC the host_read_blob
          // input may include an optional repo field.
          const inputWithRepo = input as HostReadBlobInput & { repo?: string };
          const repo = inputWithRepo.repo ?? "";

          fetchBlobByCid(input.cid, repo).then((bytes) => {
            result = {
              ok: true,
              mimeType: "application/octet-stream",
              bytesBase64: Buffer.from(bytes).toString("base64"),
            };
            settled = true;
          }).catch((e: Error) => {
            result = { ok: false, error: String(e.message) };
            settled = true;
          });

          const deadline = Date.now() + 5000;
          while (!settled && Date.now() < deadline) {}

          if (!settled) {
            return errorOutput(ctx, "host_read_blob timed out");
          }

          return writeOutput(ctx, result!);
        } catch (e) {
          return errorOutput(ctx, String(e));
        }
      },

      host_list_collection: (ptr: number, len: number): bigint => {
        try {
          const input = readInput<HostListCollectionInput>(ctx.memory, ptr, len);
          if (!input.repo || !input.collection) {
            return errorOutput(ctx, "host_list_collection: missing repo or collection");
          }

          const limit = Math.min(input.limit ?? 25, 100);

          let result: HostListCollectionOutput;
          let settled = false;

          listCollection(input.repo, input.collection, input.cursor, limit)
            .then((r) => {
              result = { ok: true, records: r.records, cursor: r.cursor };
              settled = true;
            })
            .catch((e: Error) => {
              result = { ok: false, error: String(e.message) };
              settled = true;
            });

          const deadline = Date.now() + 5000;
          while (!settled && Date.now() < deadline) {}

          if (!settled) {
            return errorOutput(ctx, "host_list_collection timed out");
          }

          return writeOutput(ctx, result!);
        } catch (e) {
          return errorOutput(ctx, String(e));
        }
      },
    },
  };
}
