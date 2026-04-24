import { fetchRecord, fetchBlobByCid, listCollection } from "../lib/atproto.js";

/**
 * Builds the host imports object in the shape jco expects for the
 * `atfunc:runtime/atproto` interface defined in wit/at-functions.wit.
 */
export function buildComponentHostImports() {
  return {
    "atfunc:runtime/atproto": {
      readRecord: async (atUri: string): Promise<string> => {
        const { record } = await fetchRecord(atUri);
        return JSON.stringify(record);
      },

      readBlob: async (cid: string, repo: string): Promise<Uint8Array> => {
        return fetchBlobByCid(cid, repo);
      },

      listCollection: async (
        repo: string,
        collection: string,
        cursor: string | null | undefined,
        limit: number
      ): Promise<string> => {
        const clampedLimit = Math.min(limit, 100);
        const result = await listCollection(
          repo,
          collection,
          cursor ?? undefined,
          clampedLimit
        );
        return JSON.stringify(result);
      },
    },
  };
}
