export type ExecutionMode = "pure-v1" | "host-v1";

export interface AtUri {
  repo: string;
  collection: string;
  rkey: string;
}

export interface FunctionRecord {
  name: string;
  version: string;
  description?: string;
  mode: ExecutionMode;
  code: BlobRef;
  entrypoint: "run";
  inputEncoding: "application/json";
  outputEncoding: "application/json";
  maxMemoryMb: number;
  maxDurationMs: number;
  public?: boolean;
  allowedHosts?: string[];
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface BlobRef {
  $type: "blob";
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface RunRequest {
  function: string;
  input: unknown;
}

export interface RunResponse {
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs?: number;
  functionCid?: string;
}

export interface WasmExports {
  memory: WebAssembly.Memory;
  alloc: (len: number) => number;
  run: (ptr: number, len: number) => bigint;
  dealloc?: (ptr: number, len: number) => void;
}

export interface HostReadRecordInput {
  atUri: string;
}

export interface HostReadRecordOutput {
  ok: boolean;
  record?: unknown;
  cid?: string;
  error?: string;
}

export interface HostReadBlobInput {
  cid: string;
}

export interface HostReadBlobOutput {
  ok: boolean;
  mimeType?: string;
  bytesBase64?: string;
  error?: string;
}

export interface HostListCollectionInput {
  repo: string;
  collection: string;
  cursor?: string;
  limit?: number;
}

export interface HostListCollectionOutput {
  ok: boolean;
  records?: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
  error?: string;
}
