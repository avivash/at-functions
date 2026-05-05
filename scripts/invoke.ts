// Invoke a registered AT Function via the local server.
//
// Usage:
//   pnpm exec tsx scripts/invoke.ts \
//     --function "at://did:plc:.../at.functions.metadata/echo-v1" \
//     --input '{"hello":"world"}'
//
//   Optionally set SERVER_URL env var (default: http://localhost:3000)

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = process.env.PORT ?? "3000";
const SERVER_URL = process.env.SERVER_URL ?? `http://${HOST}:${PORT}`;
const functionUri = arg("--function");
const inputStr = arg("--input") ?? "{}";

if (!functionUri) {
  console.error(
    'Usage: pnpm exec tsx scripts/invoke.ts --function "at://..." --input \'{"key":"value"}\''
  );
  process.exit(1);
}

let input: unknown;
try {
  input = JSON.parse(inputStr);
} catch {
  console.error("--input must be valid JSON");
  process.exit(1);
}

console.log(`Invoking: ${functionUri}`);
console.log(`Input:    ${JSON.stringify(input)}`);
console.log(`Server:   ${SERVER_URL}`);
console.log();

const response = await fetch(`${SERVER_URL}/xrpc/at.functions.run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ function: functionUri, input }),
});

const result = await response.json();

console.log("Response:", JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

export {};
