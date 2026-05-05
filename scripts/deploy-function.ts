// Deploy (upload + register/update) an AT Function in one command.
//
// This always performs a putRecord on at.functions.metadata (setting updatedAt),
// ensuring the repo emits a commit that downstream indexers can ingest.
//
// Usage:
//   ATPROTO_IDENTIFIER=you.bsky.social ATPROTO_PASSWORD=xxx \
//     pnpm exec tsx scripts/deploy-function.ts \
//       --wasm path/to/function.wasm \
//       --name "greeter" \
//       --version "1.0.0" \
//       --mode "pure-v1" \
//       --rkey "greeter-v1"

import { readFileSync } from 'node:fs'
import { AtpAgent } from '@atproto/api'

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  return idx !== -1 ? process.argv[idx + 1] : undefined
}

const SERVICE = process.env.ATPROTO_SERVICE ?? 'https://bsky.social'
const IDENTIFIER = process.env.ATPROTO_IDENTIFIER
const PASSWORD = process.env.ATPROTO_PASSWORD

if (!IDENTIFIER || !PASSWORD) {
  console.error('Set ATPROTO_IDENTIFIER and ATPROTO_PASSWORD env vars')
  process.exit(1)
}

const wasmPath = arg('--wasm')
if (!wasmPath) {
  console.error('Usage: pnpm exec tsx scripts/deploy-function.ts --wasm <path-to.wasm> --name ... --version ... --mode ... --rkey ...')
  process.exit(1)
}

const name = (arg('--name') ?? '').trim()
const version = (arg('--version') ?? '').trim()
const mode = (arg('--mode') ?? '').trim()
const rkey = (arg('--rkey') ?? '').trim()
const description = arg('--description')
const maxMemoryMb = parseInt(arg('--maxMemoryMb') ?? '32', 10)
const maxDurationMs = parseInt(arg('--maxDurationMs') ?? '100', 10)

if (!name || !version || !mode || !rkey) {
  console.error('Missing required flags: --name, --version, --mode, --rkey')
  process.exit(1)
}

const wasmBytes = readFileSync(wasmPath)
console.log(`Uploading ${wasmPath} (${wasmBytes.byteLength} bytes)…`)

const agent = new AtpAgent({ service: SERVICE })
await agent.login({ identifier: IDENTIFIER, password: PASSWORD })

const blob = (await agent.uploadBlob(wasmBytes, { encoding: 'application/wasm' })).data.blob
console.log('Blob CID:', blob.ref.toString())

const record = {
  $type: 'at.functions.metadata',
  name,
  version,
  updatedAt: new Date().toISOString(),
  description,
  mode,
  code: blob,
  entrypoint: 'run',
  inputEncoding: 'application/json',
  outputEncoding: 'application/json',
  maxMemoryMb,
  maxDurationMs,
  public: true,
}

const { data } = await agent.com.atproto.repo.putRecord({
  repo: agent.did!,
  collection: 'at.functions.metadata',
  rkey,
  record,
})

console.log('Deployed!')
console.log('URI:', data.uri)
console.log('CID:', data.cid)

