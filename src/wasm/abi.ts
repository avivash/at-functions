import type { WasmExports } from "../lib/types.js";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function packPtrLen(ptr: number, len: number): bigint {
  // Upper 32 bits = ptr, lower 32 bits = len
  return (BigInt(ptr) << 32n) | BigInt(len);
}

export function unpackPtrLen(packed: bigint): { ptr: number; len: number } {
  const ptr = Number(packed >> 32n);
  const len = Number(packed & 0xffffffffn);
  return { ptr, len };
}

export function writeToMemory(
  memory: WebAssembly.Memory,
  ptr: number,
  bytes: Uint8Array
): void {
  const view = new Uint8Array(memory.buffer);
  view.set(bytes, ptr);
}

export function readFromMemory(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number
): Uint8Array {
  const view = new Uint8Array(memory.buffer);
  return view.slice(ptr, ptr + len);
}

export function callWasmFunction(
  exports: WasmExports,
  input: unknown
): unknown {
  const inputBytes = TEXT_ENCODER.encode(JSON.stringify(input));
  const len = inputBytes.byteLength;

  const ptr = exports.alloc(len);
  if (ptr === 0) {
    throw new Error("WASM alloc returned null pointer");
  }

  writeToMemory(exports.memory, ptr, inputBytes);

  const packed = exports.run(ptr, len);
  const { ptr: outPtr, len: outLen } = unpackPtrLen(packed);

  if (outLen === 0) {
    throw new Error("WASM run returned zero-length output");
  }

  const outputBytes = readFromMemory(exports.memory, outPtr, outLen);
  const outputJson = TEXT_DECODER.decode(outputBytes);

  if (exports.dealloc) {
    exports.dealloc(outPtr, outLen);
  }

  return JSON.parse(outputJson);
}

export function validateExports(
  instance: WebAssembly.Instance,
  mode: string
): WasmExports {
  const exp = instance.exports;

  if (!(exp.memory instanceof WebAssembly.Memory)) {
    throw new Error("WASM module must export 'memory'");
  }
  if (typeof exp.alloc !== "function") {
    throw new Error("WASM module must export 'alloc(len)->ptr'");
  }
  if (typeof exp.run !== "function") {
    throw new Error("WASM module must export 'run(ptr,len)->i64'");
  }

  return {
    memory: exp.memory as WebAssembly.Memory,
    alloc: exp.alloc as (len: number) => number,
    run: exp.run as (ptr: number, len: number) => bigint,
    dealloc:
      typeof exp.dealloc === "function"
        ? (exp.dealloc as (ptr: number, len: number) => void)
        : undefined,
  };
}

// Cap memory pages to enforce maxMemoryMb
export function memoryPagesForMb(mb: number): number {
  // 1 WASM page = 64 KiB
  return Math.ceil((mb * 1024 * 1024) / (64 * 1024));
}
