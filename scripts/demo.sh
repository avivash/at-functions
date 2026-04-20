#!/usr/bin/env bash
# AT Functions — asciinema demo script
# Requires: server running, ATPROTO_IDENTIFIER + ATPROTO_PASSWORD in .env

set -e
export TERM=xterm-256color

# Load .env
set -a
source "$(dirname "$0")/../.env"
set +a

REPO_DID=$(bun -e "
const { AtpAgent } = require('@atproto/api');
const a = new AtpAgent({ service: process.env.ATPROTO_SERVICE ?? 'https://bsky.social' });
a.login({ identifier: process.env.ATPROTO_IDENTIFIER, password: process.env.ATPROTO_PASSWORD })
  .then(() => { process.stdout.write(a.did); });
" 2>/dev/null)

FUNCTION_PURE="at://$REPO_DID/at.functions.metadata/echo-v1"
FUNCTION_HOST="at://$REPO_DID/at.functions.metadata/lister-v1"

type() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.04
  done
}
pause() { sleep "${1:-1.5}"; }

# ── Setup (silent, not recorded) ─────────────────────────────────────────────

upload_and_register() {
  local wasm="$1" mode="$2" rkey="$3" name="$4" max_ms="${5:-100}"
  local blob
  blob=$(bun scripts/upload-function.ts "$wasm" 2>/dev/null \
    | awk '/^\{/,/^\}/' | tr -d '\n')
  bun scripts/create-function-record.ts \
    --name "$name" --version "0.1.0" --mode "$mode" --rkey "$rkey" \
    --maxDurationMs "$max_ms" \
    --blob "$blob" > /dev/null 2>&1
}

upload_and_register \
  examples/pure-rust/target/wasm32-unknown-unknown/release/pure_echo.wasm \
  pure-v1 echo-v1 echo 500

upload_and_register \
  examples/host-rust/target/wasm32-unknown-unknown/release/host_lister.wasm \
  host-v1 lister-v1 lister 5000

# ── Demo ─────────────────────────────────────────────────────────────────────

clear
pause 1

type "# AT Functions POC"
echo; pause 0.5
type "# AT Protocol as a code registry + WASM execution runtime"
echo; pause 2

echo
type "# 1. Check the server is up"
echo; pause 0.8
type "curl -s http://127.0.0.1:4700/health | jq ."
echo; pause 0.5
curl -s http://127.0.0.1:4700/health | jq .
pause 2

echo
type "# 2. Invoke the pure-v1 echo function"
echo; pause 0.8
type "bun scripts/invoke.ts --function \"$FUNCTION_PURE\" --input '{\"hello\":\"world\",\"num\":42}'"
echo; pause 0.6
bun scripts/invoke.ts \
  --function "$FUNCTION_PURE" \
  --input '{"hello":"world","num":42}'
pause 3

echo
type "# 3. Invoke the host-v1 function (reads live AT Proto data)"
echo; pause 0.8
type "bun scripts/invoke.ts --function \"$FUNCTION_HOST\" --input '{\"repo\":\"$REPO_DID\",\"collection\":\"app.bsky.feed.post\",\"limit\":3}'"
echo; pause 0.6
bun scripts/invoke.ts \
  --function "$FUNCTION_HOST" \
  --input "{\"repo\":\"$REPO_DID\",\"collection\":\"app.bsky.feed.post\",\"limit\":3}"
pause 3

echo
type "# Done. Functions stored on AT Proto, invoked over XRPC."
echo; pause 2
