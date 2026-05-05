// Create an at.functions.metadata record on AT Proto.
//
// Usage (fill in the blob JSON from upload-function.ts output):
//   ATPROTO_IDENTIFIER=you.bsky.social ATPROTO_PASSWORD=xxx \
//     pnpm exec tsx scripts/create-function-record.ts \
//       --name "echo" \
//       --version "0.1.0" \
//       --mode "pure-v1" \
//       --rkey "echo-v1" \
//       --description "Echoes the input JSON back to you." \
//       --inputSchema '{"type":"object","additionalProperties":true}' \
//       --outputSchema '{"type":"object","additionalProperties":true}' \
//       --blob '{"$type":"blob","ref":{"$link":"bafk..."},"mimeType":"application/wasm","size":12345}'

import { AtpAgent } from "@atproto/api";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const SERVICE = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
const IDENTIFIER = process.env.ATPROTO_IDENTIFIER;
const PASSWORD = process.env.ATPROTO_PASSWORD;

if (!IDENTIFIER || !PASSWORD) {
  console.error("Set ATPROTO_IDENTIFIER and ATPROTO_PASSWORD env vars");
  process.exit(1);
}

const name = arg("--name") ?? "my-function";
const version = arg("--version") ?? "0.1.0";
const mode = arg("--mode") ?? "pure-v1";
const rkey = arg("--rkey") ?? name;
const description = arg("--description");
const inputSchemaJson = arg("--inputSchema");
const outputSchemaJson = arg("--outputSchema");
const blobJson = arg("--blob");
const maxMemoryMb = parseInt(arg("--maxMemoryMb") ?? "32", 10);
const maxDurationMs = parseInt(arg("--maxDurationMs") ?? "100", 10);

if (!blobJson) {
  console.error(
    "Provide --blob with the JSON blob ref from upload-function.ts output"
  );
  process.exit(1);
}

let blob: unknown;
try {
  blob = JSON.parse(blobJson);
} catch {
  console.error("--blob must be valid JSON");
  process.exit(1);
}

let inputSchema: unknown = undefined;
let outputSchema: unknown = undefined;
try {
  if (inputSchemaJson) inputSchema = JSON.parse(inputSchemaJson);
} catch {
  console.error("--inputSchema must be valid JSON");
  process.exit(1);
}
try {
  if (outputSchemaJson) outputSchema = JSON.parse(outputSchemaJson);
} catch {
  console.error("--outputSchema must be valid JSON");
  process.exit(1);
}

const agent = new AtpAgent({ service: SERVICE });
await agent.login({ identifier: IDENTIFIER, password: PASSWORD });

const record = {
  $type: "at.functions.metadata",
  name,
  version,
  updatedAt: new Date().toISOString(),
  description,
  mode,
  code: blob,
  entrypoint: "run",
  inputEncoding: "application/json",
  outputEncoding: "application/json",
  maxMemoryMb,
  maxDurationMs,
  public: true,
  ...(inputSchema !== undefined ? { inputSchema } : {}),
  ...(outputSchema !== undefined ? { outputSchema } : {}),
};

const { data } = await agent.com.atproto.repo.putRecord({
  repo: agent.did!,
  collection: "at.functions.metadata",
  rkey,
  record,
});

console.log("Function record created/updated!");
console.log("URI:", data.uri);
console.log("CID:", data.cid);
console.log();
console.log(`Invoke with:`);
console.log(
  `  pnpm exec tsx scripts/invoke.ts --function "${data.uri}" --input '{"hello":"world"}'`
);
