// Worker thread: executes host-v1 WASM with synchronous host import bridges.
// Uses Atomics.wait (allowed in worker threads) to block while the main thread
// handles async AT Proto I/O via the SharedArrayBuffer protocol.
//
// SAB layout (all little-endian, offsets in bytes):
//   [0..3]   i32 signal  — 0=idle, 1=request, 2=response, 3=finished
//   [4..7]   i32 reqLen  — byte length of request JSON in data region
//   [8..11]  i32 resLen  — byte length of response JSON in data region
//   [12..]   u8  data    — request/response JSON bytes

import { workerData, parentPort } from "node:worker_threads";

const { wasmBytes, inputJson, maxMemoryMb, sab } = workerData;

const HEADER_BYTES = 12;
const SIG_IDX = 0;
const REQ_IDX = 1;
const RES_IDX = 2;
const SIG_REQUEST = 1;
const SIG_DONE = 3;

const header = new Int32Array(sab, 0, 3);
const data = new Uint8Array(sab, HEADER_BYTES);

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function packPtrLen(ptr, len) {
  return (BigInt(ptr) << 32n) | BigInt(len);
}

function unpackPtrLen(packed) {
  const b = BigInt(packed);
  return { ptr: Number(b >> 32n), len: Number(b & 0xffffffffn) };
}

function hostCall(fn, inputObj) {
  const reqBytes = TEXT_ENCODER.encode(JSON.stringify({ fn, input: inputObj }));
  data.set(reqBytes, 0);
  Atomics.store(header, REQ_IDX, reqBytes.byteLength);
  Atomics.store(header, SIG_IDX, SIG_REQUEST);
  Atomics.notify(header, SIG_IDX);
  Atomics.wait(header, SIG_IDX, SIG_REQUEST);
  const resLen = Atomics.load(header, RES_IDX);
  return TEXT_DECODER.decode(data.slice(0, resLen));
}

// ctx holds a mutable reference to the live instance's memory and alloc.
// Host imports close over ctx and read it at call-time (after instantiation),
// so they always use the correct instance memory — not a stale stub copy.
function makeHostImport(fn, ctx) {
  return (ptr, len) => {
    const view = new Uint8Array(ctx.memory.buffer, ptr, len);
    const inputObj = JSON.parse(TEXT_DECODER.decode(view));
    const resJson = hostCall(fn, inputObj);
    const resBytes = TEXT_ENCODER.encode(resJson);
    const outPtr = ctx.alloc(resBytes.byteLength);
    new Uint8Array(ctx.memory.buffer).set(resBytes, outPtr);
    return packPtrLen(outPtr, resBytes.byteLength);
  };
}

async function run() {
  try {
    const bytes = new Uint8Array(wasmBytes);
    const module = await WebAssembly.compile(bytes);

    // Detect import namespace: Rust extern "C" defaults to "env";
    // #[link(wasm_import_module = "host")] moves them to "host".
    const moduleImports = WebAssembly.Module.imports(module);
    const hostNs = moduleImports.some(i => i.module === "host") ? "host" : "env";

    // ctx is populated after instantiation; host imports read it at call-time.
    const ctx = { memory: null, alloc: null };

    const hostImports = {
      [hostNs]: {
        host_read_record:     makeHostImport("host_read_record",     ctx),
        host_read_blob:       makeHostImport("host_read_blob",       ctx),
        host_list_collection: makeHostImport("host_list_collection", ctx),
      },
      ...(hostNs !== "env" ? { env: {} } : {}),
    };

    const instance = await WebAssembly.instantiate(module, hostImports);

    // Populate ctx now so host imports use the live instance memory.
    ctx.memory = instance.exports.memory;
    ctx.alloc  = instance.exports.alloc;

    const { memory, alloc, run: runFn, dealloc } = instance.exports;
    if (!alloc || !runFn) throw new Error("Missing alloc or run export");

    const inputBytes = TEXT_ENCODER.encode(inputJson);
    const inPtr = alloc(inputBytes.byteLength);
    new Uint8Array(memory.buffer).set(inputBytes, inPtr);

    const packed = runFn(inPtr, inputBytes.byteLength);
    const { ptr: outPtr, len: outLen } = unpackPtrLen(BigInt(packed));
    const outBytes = new Uint8Array(memory.buffer).slice(outPtr, outPtr + outLen);
    if (dealloc) dealloc(outPtr, outLen);

    Atomics.store(header, SIG_IDX, SIG_DONE);
    Atomics.notify(header, SIG_IDX);
    parentPort.postMessage({ ok: true, outputJson: TEXT_DECODER.decode(outBytes) });
  } catch (e) {
    Atomics.store(header, SIG_IDX, SIG_DONE);
    Atomics.notify(header, SIG_IDX);
    parentPort.postMessage({ ok: false, error: String(e.message ?? e) });
  }
}

run();
