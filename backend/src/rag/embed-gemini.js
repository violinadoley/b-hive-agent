/**
 * Gemini embeddings for Qdrant (Google AI Gemini API).
 * Model: gemini-embedding-001 — see https://ai.google.dev/api/embeddings
 * Uses outputDimensionality 1536 so vectors match prior OpenAI/Qdrant collection size.
 */
const MODEL_ID = "gemini-embedding-001";
const MODEL_RESOURCE = `models/${MODEL_ID}`;
const VECTOR_SIZE = 1536;

const BATCH_URL = `https://generativelanguage.googleapis.com/v1beta/${MODEL_RESOURCE}:batchEmbedContents`;
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/${MODEL_RESOURCE}:embedContent`;

async function embedTexts(texts, apiKey) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini embeddings");
  }
  const out = [];
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize).map((t) => String(t).slice(0, 8000));
    const requests = slice.map((text) => ({
      model: MODEL_RESOURCE,
      content: { parts: [{ text }] },
      outputDimensionality: VECTOR_SIZE,
      taskType: "RETRIEVAL_DOCUMENT",
    }));
    const res = await fetch(BATCH_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || JSON.stringify(data).slice(0, 300);
      throw new Error(`Gemini batchEmbedContents HTTP ${res.status}: ${msg}`);
    }
    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== slice.length) {
      throw new Error("Gemini batchEmbedContents: unexpected response shape");
    }
    for (const emb of embeddings) {
      const values = emb.values;
      if (!Array.isArray(values) || values.length !== VECTOR_SIZE) {
        throw new Error(
          `Gemini embedding: expected ${VECTOR_SIZE} dimensions, got ${values?.length ?? 0}`,
        );
      }
      out.push(values);
    }
  }
  return out;
}

async function embedQuery(text, apiKey) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini embeddings");
  }
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_RESOURCE,
      content: { parts: [{ text: String(text).slice(0, 8000) }] },
      outputDimensionality: VECTOR_SIZE,
      taskType: "RETRIEVAL_QUERY",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`Gemini embedContent HTTP ${res.status}: ${msg}`);
  }
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length !== VECTOR_SIZE) {
    throw new Error(
      `Gemini query embedding: expected ${VECTOR_SIZE} dimensions, got ${values?.length ?? 0}`,
    );
  }
  return values;
}

module.exports = {
  embedTexts,
  embedQuery,
  EMBED_MODEL: MODEL_ID,
  VECTOR_SIZE,
};
