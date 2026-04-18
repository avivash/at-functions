// Create an app.atfunc.function record on AT Proto.
//
// Usage (fill in the blob JSON from upload-function.ts output):
//   ATPROTO_IDENTIFIER=you.bsky.social ATPROTO_PASSWORD=xxx \
//     bun scripts/create-function-record.ts \
//       --name "echo" \
//       --version "0.1.0" \
//       --mode "pure-v1" \
//       --rkey "echo-v1" \
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

const agent = new AtpAgent({ service: SERVICE });
await agent.login({ identifier: IDENTIFIER, password: PASSWORD });

const record = {
  $type: "app.atfunc.function",
  name,
  version,
  description,
  mode,
  code: blob,
  entrypoint: "run",
  inputEncoding: "application/json",
  outputEncoding: "application/json",
  maxMemoryMb,
  maxDurationMs,
  public: true,
};

const { data } = await agent.com.atproto.repo.putRecord({
  repo: agent.did!,
  collection: "app.atfunc.function",
  rkey,
  record,
});

console.log("Function record created!");
console.log("URI:", data.uri);
console.log("CID:", data.cid);
console.log();
console.log(`Invoke with:`);
console.log(
  `  bun scripts/invoke.ts --function "${data.uri}" --input '{"hello":"world"}'`
);
