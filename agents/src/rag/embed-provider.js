/**
 * Embedding backend for RAG: prefers Gemini (gemini-embedding-001), else OpenAI (text-embedding-3-small).
 * Both target 1536-dim vectors for a single Qdrant collection geometry.
 */
const { getConfig } = require("../config");
const gemini = require("./embed-gemini");
const openai = require("./embed-openai");

const VECTOR_SIZE = gemini.VECTOR_SIZE;

function pickBackend() {
  const c = getConfig();
  if (c.geminiApiKey) {
    return {
      kind: "gemini",
      key: c.geminiApiKey,
      modelLabel: gemini.EMBED_MODEL,
      embedTexts: (texts) => gemini.embedTexts(texts, c.geminiApiKey),
      embedQuery: (q) => gemini.embedQuery(q, c.geminiApiKey),
    };
  }
  if (c.openaiApiKey) {
    return {
      kind: "openai",
      key: c.openaiApiKey,
      modelLabel: openai.EMBED_MODEL,
      embedTexts: (texts) => openai.embedTexts(texts, c.openaiApiKey),
      embedQuery: (q) => openai.embedQuery(q, c.openaiApiKey),
    };
  }
  return null;
}

function requireBackend() {
  const b = pickBackend();
  if (!b) {
    throw new Error(
      "Set GEMINI_API_KEY (recommended: gemini-embedding-001) or OPENAI_API_KEY for embeddings",
    );
  }
  return b;
}

async function embedTexts(texts) {
  const b = requireBackend();
  return b.embedTexts(texts);
}

async function embedQuery(text) {
  const b = requireBackend();
  return b.embedQuery(text);
}

module.exports = {
  pickBackend,
  requireBackend,
  embedTexts,
  embedQuery,
  VECTOR_SIZE,
};
