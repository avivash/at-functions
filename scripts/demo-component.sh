#!/usr/bin/env bash
# AT Functions — component-v1 demo script
# Records an asciinema cast showing the WASI Component Model / WIT workflow.
#
# Prerequisites:
#   - Server running:  pnpm run dev
#   - ATPROTO_IDENTIFIER + ATPROTO_PASSWORD in .env
#   - wasm-tools installed:  brew install wasm-tools
#   - Rust wasm32-wasip1 target:  rustup target add wasm32-wasip1
#   - WASI reactor adapter downloaded into examples/component-rust/
#
# Run:
#   asciinema rec component-v1.cast --command scripts/demo-component.sh

set -e
export TERM=xterm-256color

# Load .env
set -a
source "$(dirname "$0")/../.env"
set +a

REPO_DID=$(node -e "
const { AtpAgent } = require('@atproto/api');
const a = new AtpAgent({ service: process.env.ATPROTO_SERVICE ?? 'https://bsky.social' });
a.login({ identifier: process.env.ATPROTO_IDENTIFIER, password: process.env.ATPROTO_PASSWORD })
  .then(() => { process.stdout.write(a.did); });
" 2>/dev/null)

FUNCTION_URI="at://$REPO_DID/at.functions.metadata/component-lister-v1"
COMPONENT_DIR="examples/component-rust"
WASM_OUT="$COMPONENT_DIR/component_lister.component.wasm"
ADAPTER="$COMPONENT_DIR/wasi_snapshot_preview1.reactor.wasm"

type_text() {
  local text="$1"
  for ((i=0; i<${#text}; i++)); do
    printf '%s' "${text:$i:1}"
    sleep 0.04
  done
}
pause() { sleep "${1:-1.5}"; }

# ── Silent setup: upload & register the component ────────────────────────────

blob=$(pnpm exec tsx scripts/upload-function.ts "$WASM_OUT" 2>/dev/null \
  | awk '/^\{/,/^\}/' | tr -d '\n')

pnpm exec tsx scripts/create-function-record.ts \
  --name "component-lister" \
  --version "0.1.0" \
  --mode "component-v1" \
  --rkey "component-lister-v1" \
  --maxDurationMs 30000 \
  --blob "$blob" > /dev/null 2>&1

# ── Demo ─────────────────────────────────────────────────────────────────────

clear
pause 1

type_text "# AT Functions — component-v1"
echo; pause 0.5
type_text "# WASI Component Model + WIT typed interfaces on AT Protocol"
echo; pause 2

echo
type_text "# The WIT interface: typed imports the function can use"
echo; pause 0.8
type_text "cat wit/at-functions.wit"
echo; pause 0.5
cat wit/at-functions.wit
pause 3

echo
type_text "# The Rust implementation — uses wit-bindgen, calls atproto::list_collection"
echo; pause 0.8
type_text "cat examples/component-rust/src/lib.rs"
echo; pause 0.5
cat examples/component-rust/src/lib.rs
pause 3

echo
type_text "# Compile to WASI P1, then wrap into a Component Model component"
echo; pause 0.8
type_text "cargo build --target wasm32-wasip1 --release  # (already built)"
echo; pause 0.8
type_text "wasm-tools component new core.wasm -o component.wasm --adapt wasi_snapshot_preview1=adapter.wasm"
echo; pause 2

echo
type_text "# Upload the component WASM blob to AT Protocol"
echo; pause 0.8
type_text "pnpm exec tsx scripts/upload-function.ts $WASM_OUT"
echo; pause 0.5
pnpm exec tsx scripts/upload-function.ts "$WASM_OUT" 2>/dev/null | awk '/^\{/,/^\}/'
pause 2

echo
type_text "# Register an at.functions.metadata record pointing at the blob"
echo; pause 0.8
type_text "pnpm exec tsx scripts/create-function-record.ts --mode component-v1 --rkey component-lister-v1 ..."
echo; pause 1.5
echo "  → at://$REPO_DID/at.functions.metadata/component-lister-v1"
pause 2

echo
type_text "# Invoke via XRPC — server fetches record + blob, transpiles with jco, runs"
echo; pause 0.8
type_text "pnpm exec tsx scripts/invoke.ts --function \"$FUNCTION_URI\" \\"
echo
type_text "  --input '{\"repo\":\"$REPO_DID\",\"collection\":\"app.bsky.feed.post\",\"limit\":3}'"
echo; pause 0.6
pnpm exec tsx scripts/invoke.ts \
  --function "$FUNCTION_URI" \
  --input "{\"repo\":\"$REPO_DID\",\"collection\":\"app.bsky.feed.post\",\"limit\":3}"
pause 4

echo
type_text "# Typed WIT imports. No raw ptr/len ABI. Any language with a WIT bindgen works."
echo; pause 2
