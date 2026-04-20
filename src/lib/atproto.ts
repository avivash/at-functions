import { AtpAgent } from "@atproto/api";
import type { AtUri, FunctionRecord } from "./types.js";

const SERVICE_URL = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
const MAX_BLOB_BYTES = parseInt(process.env.MAX_BLOB_BYTES ?? "5242880", 10);

// Shared unauthenticated agent for public reads
const agent = new AtpAgent({ service: SERVICE_URL });

export function parseAtUri(uri: string): AtUri {
  // at://repo/collection/rkey
  if (!uri.startsWith("at://")) {
    throw new Error(`Invalid AT URI (missing at:// prefix): ${uri}`);
  }
  const rest = uri.slice("at://".length);
  const parts = rest.split("/");
  if (parts.length !== 3) {
    throw new Error(`Invalid AT URI (expected at://repo/collection/rkey): ${uri}`);
  }
  const [repo, collection, rkey] = parts;
  if (!repo || !collection || !rkey) {
    throw new Error(`Invalid AT URI (empty segment): ${uri}`);
  }
  return { repo, collection, rkey };
}

export async function fetchFunctionRecord(
  atUri: string
): Promise<{ record: FunctionRecord; cid: string }> {
  const { repo, collection, rkey } = parseAtUri(atUri);

  if (collection !== "at.functions.metadata") {
    throw new Error(
      `URI must point to at.functions.metadata collection, got: ${collection}`
    );
  }

  const response = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
  const record = response.data.value as FunctionRecord;
  const cid = response.data.cid ?? "";

  if (!record.mode || !record.code) {
    throw new Error("Function record missing required fields (mode, code)");
  }

  return { record, cid };
}

export async function fetchBlob(repo: string, cid: string): Promise<Uint8Array> {
  const response = await agent.com.atproto.sync.getBlob({ did: repo, cid });

  // @atproto/api returns blob data as Uint8Array in response.data
  const data = response.data as unknown;

  let bytes: Uint8Array;
  if (data instanceof Uint8Array) {
    bytes = data;
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    throw new Error("Unexpected blob response type from AT Proto");
  }

  if (bytes.byteLength > MAX_BLOB_BYTES) {
    throw new Error(
      `Blob too large: ${bytes.byteLength} bytes (max ${MAX_BLOB_BYTES})`
    );
  }

  return bytes;
}

export async function fetchRecord(
  atUri: string
): Promise<{ record: unknown; cid: string }> {
  const { repo, collection, rkey } = parseAtUri(atUri);
  const response = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
  return {
    record: response.data.value,
    cid: response.data.cid ?? "",
  };
}

export async function listCollection(
  repo: string,
  collection: string,
  cursor?: string,
  limit?: number
): Promise<{
  records: Array<{ uri: string; cid: string; value: unknown }>;
  cursor?: string;
}> {
  const clampedLimit = Math.min(limit ?? 25, 100);
  const response = await agent.com.atproto.repo.listRecords({
    repo,
    collection,
    limit: clampedLimit,
    cursor,
  });

  return {
    records: response.data.records.map((r) => ({
      uri: r.uri,
      cid: r.cid,
      value: r.value,
    })),
    cursor: response.data.cursor,
  };
}

export async function fetchBlobByCid(cid: string, repo: string): Promise<Uint8Array> {
  return fetchBlob(repo, cid);
}
