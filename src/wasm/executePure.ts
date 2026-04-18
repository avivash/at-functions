import { callWasmFunction, memoryPagesForMb, validateExports } from "./abi.js";
import type { FunctionRecord } from "../lib/types.js";

// In-memory cache: CID -> compiled WebAssembly.Module
const moduleCache = new Map<string, WebAssembly.Module>();

export async function executePure(
  wasmBytes: Uint8Array,
  record: FunctionRecord,
  input: unknown,
  blobCid: string
): Promise<unknown> {
  let module = moduleCache.get(blobCid);
  if (!module) {
    // Copy to a plain ArrayBuffer to satisfy the BufferSource type
    const buf = wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength
    ) as ArrayBuffer;
    module = await WebAssembly.compile(buf);
    moduleCache.set(blobCid, module);
  }

  const maxPages = memoryPagesForMb(record.maxMemoryMb ?? 32);

  // pure-v1: no imports permitted
  const instance = await WebAssembly.instantiate(module, {});

  const exports = validateExports(instance, "pure-v1");

  // Enforce memory limit: grow is still possible inside the module unless
  // we wrap memory — for this POC we check the initial size is within bounds.
  const currentPages = exports.memory.buffer.byteLength / (64 * 1024);
  if (currentPages > maxPages) {
    throw new Error(
      `WASM memory (${currentPages} pages) exceeds maxMemoryMb=${record.maxMemoryMb}`
    );
  }

  return callWasmFunction(exports, input);
}
