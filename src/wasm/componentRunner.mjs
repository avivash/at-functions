/**
 * componentRunner.mjs
 *
 * Standalone Node.js script that executes a WASI Component Model WASM binary
 * using jco's programmatic transpile API. Spawned as a child process by
 * executeComponent.ts to avoid Bun compatibility issues with jco internals.
 *
 * Protocol:
 *   stdin  → JSON: { wasmBase64: string, inputJson: string }
 *   stdout → JSON: { ok: true, result: string } | { ok: false, error: string }
 *
 * Host imports MUST be synchronous.
 * jco's generated code for synchronous WIT functions calls host imports
 * synchronously and immediately passes the return value to
 * _utf8AllocateAndEncode(). Returning a Promise (an object) fails the
 * string type check. We use spawnSync to make blocking HTTP calls.
 */

import { transpile } from "@bytecodealliance/jco";
import { cli, clocks, filesystem, io, random } from "@bytecodealliance/preview2-shim";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Read payload from stdin
// ---------------------------------------------------------------------------
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { wasmBase64, inputJson } = JSON.parse(
  Buffer.concat(chunks).toString("utf8")
);

const wasmBytes = Uint8Array.from(Buffer.from(wasmBase64, "base64"));

// ---------------------------------------------------------------------------
// Synchronous AT Proto helpers
//
// jco's generated code for sync WIT functions calls host imports synchronously
// and immediately encodes the return value as a WASM string. Async functions
// return a Promise (typeof === "object"), failing jco's type check.
//
// Solution: use spawnSync to run a tiny inline Node.js script that uses
// top-level await fetch, then returns JSON to stdout. This blocks the caller.
// ---------------------------------------------------------------------------
const SERVICE = process.env.ATPROTO_SERVICE_URL ?? "https://bsky.social";

/**
 * Synchronous GET to an AT Proto XRPC endpoint.
 * Spawns a child `node --input-type=module` process so we can use async fetch.
 */
function syncAtGet(nsid, params) {
  const url = new URL(`/xrpc/${nsid}`, SERVICE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const script = `
    const res = await fetch(${JSON.stringify(url.href)});
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      process.stderr.write("HTTP " + res.status + ": " + body + "\\n");
      process.exit(1);
    }
    const data = await res.json();
    process.stdout.write(JSON.stringify(data));
  `;

  const result = spawnSync(
    process.execPath,
    ["--input-type=module"],
    { input: script, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`AT Proto ${nsid} failed (exit ${result.status}): ${stderr}`);
  }

  return JSON.parse(result.stdout.toString());
}

// ---------------------------------------------------------------------------
// WASI shim imports
// Map WASI interface names (as jco expects) to preview2-shim implementations.
// The shim uses camelCase keys; the WASI interface names use kebab-case+colons.
// ---------------------------------------------------------------------------
const wasiImports = {
  "wasi:cli/environment":         cli.environment,
  "wasi:cli/exit":                cli.exit,
  "wasi:cli/stdin":               cli.stdin,
  "wasi:cli/stdout":              cli.stdout,
  "wasi:cli/stderr":              cli.stderr,
  "wasi:cli/terminal-input":      cli.terminalInput,
  "wasi:cli/terminal-output":     cli.terminalOutput,
  "wasi:cli/terminal-stdin":      cli.terminalStdin,
  "wasi:cli/terminal-stdout":     cli.terminalStdout,
  "wasi:cli/terminal-stderr":     cli.terminalStderr,
  "wasi:clocks/monotonic-clock":  clocks.monotonicClock,
  "wasi:clocks/wall-clock":       clocks.wallClock,
  "wasi:filesystem/preopens":     filesystem.preopens,
  "wasi:filesystem/types":        filesystem.types,
  "wasi:io/error":                io.error,
  "wasi:io/poll":                 io.poll,
  "wasi:io/streams":              io.streams,
  "wasi:random/random":           random.random,
  "wasi:random/insecure":         random.insecure,
  "wasi:random/insecure-seed":    random.insecureSeed,
};

// ---------------------------------------------------------------------------
// atfunc:runtime/atproto host imports — synchronous
//
// jco converts WIT kebab-case identifiers to camelCase in JS bindings:
//   read-record      → readRecord
//   read-blob        → readBlob
//   list-collection  → listCollection
// ---------------------------------------------------------------------------
const hostImports = {
  ...wasiImports,
  "atfunc:runtime/atproto": {
    readRecord(atUri) {
      const m = atUri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (!m) throw new Error(`Invalid AT URI: ${atUri}`);
      const [, repo, collection, rkey] = m;
      const r = syncAtGet("com.atproto.repo.getRecord", { repo, collection, rkey });
      return JSON.stringify(r.value);
    },

    readBlob(cid, repo) {
      // Blobs are binary — fetch as base64 via a child node script
      const url = new URL(`/xrpc/com.atproto.sync.getBlob`, SERVICE);
      url.searchParams.set("did", repo);
      url.searchParams.set("cid", cid);

      const script = `
        const res = await fetch(${JSON.stringify(url.href)});
        if (!res.ok) { process.stderr.write("HTTP " + res.status + "\\n"); process.exit(1); }
        const buf = await res.arrayBuffer();
        process.stdout.write(Buffer.from(buf).toString("base64"));
      `;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module"],
        { input: script, timeout: 30_000, maxBuffer: 50 * 1024 * 1024 }
      );
      if (result.status !== 0) throw new Error(`readBlob failed: ${result.stderr?.toString()}`);
      return Uint8Array.from(Buffer.from(result.stdout.toString(), "base64"));
    },

    listCollection(repo, collection, cursor, limit) {
      const params = { repo, collection, limit: Math.min(limit, 100) };
      if (cursor) params.cursor = cursor;
      const r = syncAtGet("com.atproto.repo.listRecords", params);
      const records = (r.records ?? []).map((x) => ({
        uri: x.uri,
        cid: x.cid,
        value: x.value,
      }));
      return JSON.stringify({ records, cursor: r.cursor });
    },
  },
};

// ---------------------------------------------------------------------------
// Transpile + execute
// ---------------------------------------------------------------------------
let tempDir;
try {
  const transpiled = await transpile(wasmBytes, {
    name: "at-function",
    instantiation: "async",
  });

  tempDir = mkdtempSync(join(tmpdir(), "at-func-component-"));

  const fileEntries =
    transpiled.files instanceof Map
      ? [...transpiled.files]
      : Object.entries(transpiled.files);

  for (const [filename, content] of fileEntries) {
    const filePath = join(tempDir, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  const entryUrl = pathToFileURL(join(tempDir, "at-function.js")).href;
  const mod = await import(entryUrl);

  // getCoreModule must return a WebAssembly.Module (not ArrayBuffer).
  // WebAssembly.instantiate(Module, imports) → WebAssembly.Instance (has .exports)
  // WebAssembly.instantiate(ArrayBuffer, imports) → { module, instance } (no .exports at top)
  const getCoreModule = async (path) => {
    const bytes = readFileSync(join(tempDir, path));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return WebAssembly.compile(buffer);
  };

  const instance = await mod.instantiate(getCoreModule, hostImports);

  let rawResult;
  try {
    rawResult = instance.run(inputJson);
  } catch (err) {
    throw new Error(
      `Component run() error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // jco maps WIT result<string,string>:
  //   ok  → returns the string value directly (errHandling: 'throw-result-err' throws on err)
  //   err → throws ComponentError
  // Guard against both patterns for safety.
  let resultJson;
  if (typeof rawResult === "string") {
    resultJson = rawResult;
  } else if (rawResult && typeof rawResult === "object" && "tag" in rawResult) {
    if (rawResult.tag === "err") {
      throw new Error(`Component returned error: ${rawResult.val}`);
    }
    resultJson = rawResult.val;
  } else {
    throw new Error(`Unexpected return type: ${JSON.stringify(rawResult)}`);
  }

  process.stdout.write(JSON.stringify({ ok: true, result: resultJson }));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : "";
  process.stderr.write(`[componentRunner] ${stack || message}\n`);
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
} finally {
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}
