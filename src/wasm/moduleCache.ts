// Shared compiled WASM module cache keyed by blob CID
export const moduleCache = new Map<string, WebAssembly.Module>();
