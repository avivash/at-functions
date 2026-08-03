// Function discovery via AT Search.
//
// AT Search indexes at.functions.metadata records from the firehose (any PDS)
// and supports lexicon-filtered queries: `<free text> type:at.functions.metadata`.
// These helpers build that query and map AT Search results into a compact
// discovery shape; the HTTP call lives in routes/discover.ts.

export interface DiscoveredFunction {
  uri: string;
  cid: string;
  name: string;
  description?: string;
  tags?: string[];
  score: number;
  verified: boolean;
}

interface AtSearchResult {
  ref?: { uri?: unknown; cid?: unknown };
  record?: {
    title?: unknown;
    description?: unknown;
    tags?: unknown;
  };
  score?: unknown;
  verified?: unknown;
}

const FUNCTION_COLLECTION = "at.functions.metadata";

/** Free text + lexicon filter; bare filter lists every indexed function. */
export function buildDiscoveryQuery(q: string | undefined): string {
  const text = (q ?? "").trim();
  return text ? `${text} type:${FUNCTION_COLLECTION}` : `type:${FUNCTION_COLLECTION}`;
}

/** Map raw AT Search results to DiscoveredFunction, defensively. */
export function mapSearchResults(
  results: unknown,
  limit: number
): DiscoveredFunction[] {
  if (!Array.isArray(results)) return [];
  const out: DiscoveredFunction[] = [];
  for (const raw of results) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as AtSearchResult;
    const uri = r.ref?.uri;
    const cid = r.ref?.cid;
    if (typeof uri !== "string" || typeof cid !== "string") continue;
    if (!uri.includes(`/${FUNCTION_COLLECTION}/`)) continue;

    out.push({
      uri,
      cid,
      name: typeof r.record?.title === "string" ? r.record.title : uri,
      description:
        typeof r.record?.description === "string" ? r.record.description : undefined,
      tags: Array.isArray(r.record?.tags)
        ? (r.record.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : undefined,
      score: typeof r.score === "number" ? r.score : 0,
      verified: r.verified === true,
    });
    if (out.length >= limit) break;
  }
  return out;
}
