import { describe, it, expect } from "vitest";
import { buildDiscoveryQuery, mapSearchResults } from "../src/lib/discovery.js";

// ---------------------------------------------------------------------------
// Discovery via AT Search: query building + result mapping
// ---------------------------------------------------------------------------

describe("buildDiscoveryQuery", () => {
  it("bare listing when no text is given", () => {
    expect(buildDiscoveryQuery(undefined)).toBe("type:at.functions.metadata");
    expect(buildDiscoveryQuery("")).toBe("type:at.functions.metadata");
    expect(buildDiscoveryQuery("   ")).toBe("type:at.functions.metadata");
  });

  it("combines free text with the lexicon filter", () => {
    expect(buildDiscoveryQuery("resize image")).toBe(
      "resize image type:at.functions.metadata"
    );
    expect(buildDiscoveryQuery("  echo  ")).toBe(
      "echo type:at.functions.metadata"
    );
  });
});

describe("mapSearchResults", () => {
  const result = (overrides: Record<string, unknown> = {}) => ({
    ref: {
      uri: "at://did:plc:abc/at.functions.metadata/echo-v1",
      cid: "bafyecho",
    },
    record: {
      $type: "at.functions.metadata",
      title: "echo v1.0.0",
      description: "Echoes input back",
      tags: ["at-functions", "wasm", "pure-v1"],
    },
    score: 7,
    verified: true,
    ...overrides,
  });

  it("maps AT Search results to discovered functions", () => {
    const [fn] = mapSearchResults([result()], 25);
    expect(fn).toEqual({
      uri: "at://did:plc:abc/at.functions.metadata/echo-v1",
      cid: "bafyecho",
      name: "echo v1.0.0",
      description: "Echoes input back",
      tags: ["at-functions", "wasm", "pure-v1"],
      score: 7,
      verified: true,
    });
  });

  it("filters out non-function records defensively", () => {
    const post = result({
      ref: { uri: "at://did:plc:abc/app.bsky.feed.post/xyz", cid: "bafypost" },
    });
    expect(mapSearchResults([post, result()], 25)).toHaveLength(1);
  });

  it("respects the limit", () => {
    const many = [result(), result(), result()];
    expect(mapSearchResults(many, 2)).toHaveLength(2);
  });

  it("tolerates garbage input", () => {
    expect(mapSearchResults(undefined, 25)).toEqual([]);
    expect(mapSearchResults("nope", 25)).toEqual([]);
    expect(mapSearchResults([{}, null, { ref: {} }], 25)).toEqual([]);
  });

  it("falls back to the URI when the record has no title", () => {
    const bare = result({ record: { $type: "at.functions.metadata" } });
    const [fn] = mapSearchResults([bare], 25);
    expect(fn.name).toBe("at://did:plc:abc/at.functions.metadata/echo-v1");
    expect(fn.verified).toBe(true);
  });
});
