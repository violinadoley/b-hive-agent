#!/usr/bin/env node
/**
 * Ingest repo `docs/*.md` into Qdrant for RAG.
 * Requires: QDRANT_URL, GEMINI_API_KEY (or OPENAI_API_KEY); optional QDRANT_API_KEY, QDRANT_COLLECTION.
 * Run from `agents/`: npm run rag:seed
 */
const path = require("path");
const { ingestMarkdownDir } = require("../src/rag/qdrant-rag");

async function main() {
  const docsDir = path.join(__dirname, "..", "..", "docs");
  const result = await ingestMarkdownDir(docsDir);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
