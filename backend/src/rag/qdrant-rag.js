/**
 * Qdrant-backed RAG: ingest markdown chunks + semantic search.
 * Requires QDRANT_URL (+ QDRANT_API_KEY if cloud). Semantic path requires GEMINI_API_KEY or OPENAI_API_KEY.
 */
const { QdrantClient } = require("@qdrant/js-client-rest");
const { getConfig } = require("../config");
const { embedQuery, embedTexts, VECTOR_SIZE } = require("./embed-provider");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function getClient() {
  const { qdrantUrl, qdrantApiKey } = getConfig();
  if (!qdrantUrl) {
    throw new Error("QDRANT_URL is not set");
  }
  const opts = { url: qdrantUrl };
  if (qdrantApiKey) opts.apiKey = qdrantApiKey;
  return new QdrantClient(opts);
}

async function pingQdrant() {
  const client = getClient();
  const collections = await client.getCollections();
  return { ok: true, collections: collections.collections?.map((c) => c.name) || [] };
}

async function ensureCollection() {
  const client = getClient();
  const { qdrantCollection } = getConfig();
  try {
    await client.getCollection(qdrantCollection);
  } catch {
    await client.createCollection(qdrantCollection, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }
  return qdrantCollection;
}

function chunkText(text, maxLen = 900) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let buf = "";
  for (const p of paragraphs) {
    if ((buf + p).length > maxLen && buf) {
      chunks.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

/**
 * Index all `.md` files under a directory (e.g. repo docs/).
 */
async function ingestMarkdownDir(absDir, { dryRun = false } = {}) {
  const { qdrantCollection } = getConfig();
  if (dryRun) {
    return { dryRun: true, wouldRead: absDir };
  }

  await ensureCollection();
  const client = getClient();

  const files = [];
  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith(".md")) files.push(full);
    }
  }
  walk(absDir);

  const batch = [];
  for (const file of files) {
    const rel = path.relative(absDir, file);
    const body = fs.readFileSync(file, "utf8");
    const parts = chunkText(body);
    const vectors = await embedTexts(parts);
    for (let i = 0; i < parts.length; i++) {
      const id = crypto.randomUUID();
      batch.push({
        id,
        vector: vectors[i],
        payload: {
          text: parts[i],
          source: rel,
          chunk_index: i,
        },
      });
    }
  }

  if (batch.length === 0) {
    return { ingested: 0, message: "No markdown files found" };
  }

  await client.upsert(qdrantCollection, {
    wait: true,
    points: batch,
  });

  return { ingested: batch.length, collection: qdrantCollection };
}

/**
 * Semantic search over the collection.
 */
async function searchKnowledge(query, limit = 5) {
  const { qdrantCollection } = getConfig();
  const client = getClient();
  const vector = await embedQuery(query);
  const res = await client.search(qdrantCollection, {
    vector,
    limit,
    with_payload: true,
  });
  return res.map((r) => ({
    score: r.score,
    text: r.payload?.text,
    source: r.payload?.source,
  }));
}

module.exports = {
  getClient,
  pingQdrant,
  ensureCollection,
  ingestMarkdownDir,
  searchKnowledge,
  chunkText,
  VECTOR_SIZE,
};
