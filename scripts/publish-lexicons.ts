// Publish lexicon schemas to AT Proto as com.atproto.lexicon.schema records.
//
// Usage:
//   ATPROTO_IDENTIFIER=you.bsky.social ATPROTO_PASSWORD=xxx \
//     pnpm exec tsx scripts/publish-lexicons.ts
//
// Optional:
//   ATPROTO_SERVICE=https://bsky.social
//   LEXICON_IDS=at.functions.metadata,at.functions.run

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AtpAgent } from "@atproto/api";

const SERVICE = process.env.ATPROTO_SERVICE ?? "https://bsky.social";
const IDENTIFIER = process.env.ATPROTO_IDENTIFIER;
const PASSWORD = process.env.ATPROTO_PASSWORD;

if (!IDENTIFIER || !PASSWORD) {
  console.error("Set ATPROTO_IDENTIFIER and ATPROTO_PASSWORD env vars");
  process.exit(1);
}

const LEXICON_DIR = join(import.meta.dirname, "..", "lexicons");

type LexiconDoc = {
  lexicon: number;
  id: string;
  description?: string;
  defs: Record<string, unknown>;
};

function loadLexiconDocs(): LexiconDoc[] {
  const allow = (process.env.LEXICON_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowSet = allow.length ? new Set(allow) : null;

  const files = readdirSync(LEXICON_DIR).filter((f) => f.endsWith(".json"));
  const out: LexiconDoc[] = [];

  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(LEXICON_DIR, f), "utf8")) as Partial<LexiconDoc>;
    if (raw.lexicon !== 1 || typeof raw.id !== "string" || typeof raw.defs !== "object" || !raw.defs) {
      throw new Error(`Invalid lexicon file: ${f}`);
    }
    if (allowSet && !allowSet.has(raw.id)) continue;
    out.push(raw as LexiconDoc);
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

const agent = new AtpAgent({ service: SERVICE });
await agent.login({ identifier: IDENTIFIER, password: PASSWORD });

const docs = loadLexiconDocs();
if (docs.length === 0) {
  console.error(`No lexicons found to publish in ${LEXICON_DIR}`);
  process.exit(1);
}

console.log(`Publishing ${docs.length} lexicon(s) from ${LEXICON_DIR} to ${SERVICE} as ${agent.did}...`);

for (const doc of docs) {
  const record = {
    $type: "com.atproto.lexicon.schema",
    ...doc,
  };

  const { data } = await agent.com.atproto.repo.putRecord({
    repo: agent.did!,
    collection: "com.atproto.lexicon.schema",
    rkey: doc.id,
    record,
  });

  console.log(`Published ${doc.id}`);
  console.log(`  uri: ${data.uri}`);
  console.log(`  cid: ${data.cid}`);
}

