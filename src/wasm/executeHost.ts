import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fetchRecord, fetchBlobByCid, listCollection } from "../lib/atproto.js";
import type { FunctionRecord } from "../lib/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// SharedArrayBuffer protocol — see hostWorker.mjs for full layout description.
const HEADER_BYTES = 12;
const DATA_REGION_BYTES = 2 * 1024 * 1024;
const SAB_BYTES = HEADER_BYTES + DATA_REGION_BYTES;

const SIG_IDX = 0;
const REQ_IDX = 1;
const RES_IDX = 2;
const SIG_IDLE = 0;
const SIG_REQUEST = 1;
const SIG_RESPONSE = 2;
const SIG_DONE = 3;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

async function handleHostCall(fn: string, input: unknown): Promise<string> {
  try {
    if (fn === "host_read_record") {
      const { atUri } = input as { atUri: string };
      if (!atUri) return JSON.stringify({ ok: false, error: "missing atUri" });
      const r = await fetchRecord(atUri);
      return JSON.stringify({ ok: true, record: r.record, cid: r.cid });
    }

    if (fn === "host_read_blob") {
      const inp = input as { cid: string; repo?: string };
      if (!inp.cid) return JSON.stringify({ ok: false, error: "missing cid" });
      const bytes = await fetchBlobByCid(inp.cid, inp.repo ?? "");
      return JSON.stringify({
        ok: true,
        mimeType: "application/octet-stream",
        bytesBase64: Buffer.from(bytes).toString("base64"),
      });
    }

    if (fn === "host_list_collection") {
      const inp = input as {
        repo: string;
        collection: string;
        cursor?: string;
        limit?: number;
      };
      if (!inp.repo || !inp.collection) {
        return JSON.stringify({ ok: false, error: "missing repo or collection" });
      }
      const limit = Math.min(inp.limit ?? 25, 100);
      const r = await listCollection(inp.repo, inp.collection, inp.cursor, limit);
      return JSON.stringify({ ok: true, records: r.records, cursor: r.cursor });
    }

    return JSON.stringify({ ok: false, error: `unknown host fn: ${fn}` });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
}

export async function executeHost(
  wasmBytes: Uint8Array,
  record: FunctionRecord,
  input: unknown,
  _blobCid: string
): Promise<unknown> {
  const sab = new SharedArrayBuffer(SAB_BYTES);
  const header = new Int32Array(sab, 0, 3);
  const data = new Uint8Array(sab, HEADER_BYTES);

  const workerPath = join(__dirname, "hostWorker.mjs");

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData: {
        wasmBytes: Array.from(wasmBytes),
        inputJson: JSON.stringify(input),
        maxMemoryMb: record.maxMemoryMb ?? 32,
        sab,
      },
    });

    // Poll the SAB for host call requests from the worker thread.
    // The worker uses Atomics.wait to block; we use setImmediate to yield
    // the event loop so async AT Proto calls can complete.
    let active = true;

    function poll() {
      if (!active) return;
      const signal = Atomics.load(header, SIG_IDX);

      if (signal === SIG_REQUEST) {
        const reqLen = Atomics.load(header, REQ_IDX);
        const reqBytes = data.slice(0, reqLen);
        const { fn, input: hostInput } = JSON.parse(TEXT_DECODER.decode(reqBytes)) as {
          fn: string;
          input: unknown;
        };

        handleHostCall(fn, hostInput).then((resJson) => {
          if (!active) return;
          const resBytes = TEXT_ENCODER.encode(resJson);
          data.set(resBytes, 0);
          Atomics.store(header, RES_IDX, resBytes.byteLength);
          Atomics.store(header, SIG_IDX, SIG_RESPONSE);
          Atomics.notify(header, SIG_IDX);
          setImmediate(poll);
        });
        // Don't reschedule synchronously — wait for the async handler above
        return;
      }

      if (signal !== SIG_DONE) {
        setImmediate(poll);
      }
    }

    worker.on("message", (msg: { ok: boolean; outputJson?: string; error?: string }) => {
      active = false;
      if (msg.ok && msg.outputJson !== undefined) {
        try {
          resolve(JSON.parse(msg.outputJson));
        } catch {
          reject(new Error("Failed to parse WASM output JSON"));
        }
      } else {
        reject(new Error(msg.error ?? "WASM worker error"));
      }
    });

    worker.on("error", (err) => {
      active = false;
      reject(err);
    });

    setImmediate(poll);
  });
}
