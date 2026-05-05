// Upload a compiled WASM blob to AT Proto and print the blob CID.
//
// Usage:
//   ATPROTO_IDENTIFIER=you.bsky.social ATPROTO_PASSWORD=xxx \
//     pnpm exec tsx scripts/upload-function.ts path/to/function.wasm

import { readFileSync } from "node:fs";
import { AtpAgent } from "@atproto/api";

const [, , wasmPath] = process.argv;
if (!wasmPath) {
  console.error("Usage: pnpm exec tsx scripts/upload-function.ts <path-to.wasm>");
  process.exit(1);
}

const SERVICE = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
const IDENTIFIER = process.env.ATPROTO_IDENTIFIER;
const PASSWORD = process.env.ATPROTO_PASSWORD;

if (!IDENTIFIER || !PASSWORD) {
  console.error("Set ATPROTO_IDENTIFIER and ATPROTO_PASSWORD env vars");
  process.exit(1);
}

const wasmBytes = readFileSync(wasmPath);
console.log(`Uploading ${wasmPath} (${wasmBytes.byteLength} bytes)…`);

const agent = new AtpAgent({ service: SERVICE });
await agent.login({ identifier: IDENTIFIER, password: PASSWORD });

const { data } = await agent.uploadBlob(wasmBytes, {
  encoding: "application/wasm",
});

console.log("Blob uploaded successfully.");
console.log("CID:     ", data.blob.ref.toString());
console.log("mimeType:", data.blob.mimeType);
console.log("size:    ", data.blob.size, "bytes");
console.log();
console.log("Use this blob ref in create-function-record.ts:");
console.log(JSON.stringify(data.blob.toJSON(), null, 2));
